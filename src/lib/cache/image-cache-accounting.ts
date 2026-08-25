import { randomUUID } from 'crypto';
import {
  IMAGE_CACHE_MAX_BYTES,
  IMAGE_CACHE_MAX_ENTRIES,
  IMAGE_FETCH_RATE_BURST,
  IMAGE_FETCH_RATE_REFILL_PER_MINUTE,
  IMAGE_PROCESSING_GLOBAL_MAX,
  IMAGE_PROCESSING_PER_USER_MAX,
  IMAGE_PROCESSING_QUEUE_MAX,
  IMAGE_PROCESSING_QUEUE_WAIT_MS,
  CACHE_LOCK_TTL_MS,
} from '@/lib/cache/config';
import {
  buildImageIndexKey,
  buildImageLruKey,
  buildImageUsageKey,
  IMAGE_CACHE_OBSERVABILITY_KEY,
  sha256Hex,
} from '@/lib/cache/keys';

const IMAGE_PROCESSING_LEASE_TTL_MS = 5 * 60_000;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER;
const IMAGE_QUOTA_LOCK_TTL_MS = Math.max(CACHE_LOCK_TTL_MS, 1_000);
const IMAGE_MAINTENANCE_LOCK_TTL_MS = 5 * 60_000;
const CACHE_GENERATION_KEY = 'helprr:cache:generation';

const ACQUIRE_FILL_LOCK_OPTIONS = {
  NX: true,
  PX: CACHE_LOCK_TTL_MS,
} as const;

const ACQUIRE_QUOTA_LOCK_OPTIONS = {
  NX: true,
  PX: IMAGE_QUOTA_LOCK_TTL_MS,
} as const;

const ACQUIRE_MAINTENANCE_LOCK_OPTIONS = {
  NX: true,
  PX: IMAGE_MAINTENANCE_LOCK_TTL_MS,
} as const;

export interface ImageAccountingRedis {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { NX?: boolean; PX?: number },
  ): Promise<string | null>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  hGetAll(key: string): Promise<Record<string, string>>;
}

export interface ImageIndexEntry {
  entryKey: string;
  relativePath: string;
  sizeBytes: number;
  lastUsedAt: number;
}

export interface ImageQuotaMutation {
  previous: ImageIndexEntry | null;
  evicted: ImageIndexEntry[];
  bytes: number;
  entries: number;
}

export interface ImageProcessingLease {
  token: string;
  userKey: string;
}

export type ImageObservationCounter =
  | 'cacheHits'
  | 'staleResponses'
  | 'trueMisses'
  | 'upstreamFetches'
  | 'cacheBypasses'
  | 'healthyBypasses'
  | 'registrations'
  | 'evictions'
  | 'oversizedRejections'
  | 'invalidImageRejections'
  | 'queueCapacityRejections'
  | 'clientAborts'
  | 'upstreamTimeouts'
  | 'upstreamErrors'
  | 'rateLimitRejections'
  | 'quotaLockWaits'
  | 'quotaLockTimeouts'
  | 'missingFileRecoveries'
  | 'backgroundRevalidationsStarted'
  | 'backgroundRevalidationsSucceeded'
  | 'backgroundRevalidationsFailed';

export interface ImageObservation {
  outcome:
    | 'served'
    | 'upstream-error'
    | 'upstream-timeout'
    | 'oversized'
    | 'invalid-image'
    | 'rate-limited'
    | 'queue-capacity'
    | 'client-abort'
    | 'quota-lock-timeout'
    | 'missing-file'
    | 'background-revalidation';
  validatedBytes: number;
  format: string | null;
  cacheStatus: string;
  host: string;
  counter?: ImageObservationCounter;
  increment?: number;
}

export interface ImageCacheDiagnostics {
  accountingAvailable: boolean;
  health: 'healthy' | 'revalidating' | 'degraded-storage' | 'accounting-unavailable';
  healthCheckedAt: string | null;
  queueDepth: number;
  currentRunning: number;
  maxQueueDepth: number;
  maxRunning: number;
  queueWaitLimitMs: number;
  rateBurst: number;
  rateRefillPerMinute: number;
  quotaBytes: number | null;
  quotaEntries: number | null;
  maxBytes: number;
  maxEntries: number;
  evictions: number | null;
  oversizedRejections: number | null;
  invalidImageRejections: number | null;
  upstreamFetches: number | null;
  cacheHits: number | null;
  cacheBypasses: number | null;
  healthyBypasses: number | null;
  registrations: number | null;
  staleResponses: number | null;
  trueMisses: number | null;
  queueCapacityRejections: number | null;
  clientAborts: number | null;
  upstreamTimeouts: number | null;
  upstreamErrors: number | null;
  rateLimitRejections: number | null;
  quotaLockWaits: number | null;
  quotaLockTimeouts: number | null;
  missingFileRecoveries: number | null;
  backgroundRevalidationsStarted: number | null;
  backgroundRevalidationsSucceeded: number | null;
  backgroundRevalidationsFailed: number | null;
  queueWaitP50Ms: number | null;
  queueWaitP95Ms: number | null;
  queueWaitMaxMs: number | null;
  lastOutcome: string | null;
  lastValidatedBytes: number | null;
  lastDetectedFormat: string | null;
  lastCacheStatus: string | null;
  lastHost: string | null;
}

const REGISTER_SCRIPT = `-- image-cache-register-v3
if redis.call('GET', KEYS[5]) ~= ARGV[7] then
  return {'GENERATION_CHANGED'}
end
if redis.call('GET', KEYS[6]) ~= ARGV[8] then
  return {'LOCK_LOST'}
end
redis.call('PEXPIRE', KEYS[6], ARGV[9])
local previous = redis.call('HGET', KEYS[2], ARGV[1])
local previousSize = 0
if previous then
  local ok, decoded = pcall(cjson.decode, previous)
  if ok and type(decoded) == 'table' then
    previousSize = tonumber(decoded.sizeBytes) or 0
  end
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[4])
redis.call('ZADD', KEYS[3], ARGV[5], ARGV[1])
local bytes = tonumber(redis.call('HGET', KEYS[4], 'bytes') or '0')
local entries = tonumber(redis.call('HGET', KEYS[4], 'entries') or '0')
bytes = math.max(0, bytes - previousSize + tonumber(ARGV[6]))
if not previous then entries = entries + 1 end
redis.call('HSET', KEYS[4], 'bytes', bytes, 'entries', entries)
local evicted = {}
while bytes > tonumber(ARGV[10]) or entries > tonumber(ARGV[11]) do
  local oldest = redis.call('ZRANGE', KEYS[3], 0, 0)
  if #oldest == 0 then break end
  local entryKey = oldest[1]
  local raw = redis.call('HGET', KEYS[2], entryKey)
  local size = 0
  if raw then
    local ok, decoded = pcall(cjson.decode, raw)
    if ok and type(decoded) == 'table' then
      size = tonumber(decoded.sizeBytes) or 0
    end
    table.insert(evicted, raw)
  end
  redis.call('DEL', entryKey)
  redis.call('HDEL', KEYS[2], entryKey)
  redis.call('ZREM', KEYS[3], entryKey)
  bytes = math.max(0, bytes - size)
  entries = math.max(0, entries - 1)
end
redis.call('HSET', KEYS[4], 'bytes', bytes, 'entries', entries)
if #evicted > 0 then
  local count = tonumber(redis.call('HGET', KEYS[7], 'evictions') or '0')
  redis.call('HSET', KEYS[7], 'evictions', math.min(tonumber(ARGV[12]), count + #evicted))
end
-- cjson encodes an empty Lua table as "{}", so the empty case is spelled out
-- rather than left to cjson. The reader rejects a malformed eviction list, and
-- an "{}" there would fail every fill that evicted nothing (the normal case).
local encodedEvicted = '[]'
if #evicted > 0 then encodedEvicted = cjson.encode(evicted) end
return {previous or '', encodedEvicted, tostring(bytes), tostring(entries)}`;

const ACQUIRE_PROCESSING_LEASE_SCRIPT = `-- image-cache-acquire-processing-lease-v1
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then return 0 end
local expiresAt = now + tonumber(ARGV[4])
redis.call('ZADD', KEYS[1], expiresAt, ARGV[5])
redis.call('ZADD', KEYS[2], expiresAt, ARGV[5])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[4]) * 2)
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[4]) * 2)
return 1`;

const RELEASE_PROCESSING_LEASE_SCRIPT = `-- image-cache-release-processing-lease-v1
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1`;

const TOUCH_SCRIPT = `-- image-cache-touch-v1
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local ok, decoded = pcall(cjson.decode, raw)
if not ok or type(decoded) ~= 'table' then return 0 end
if decoded.relativePath ~= ARGV[2] then return 0 end
decoded.lastUsedAt = tonumber(ARGV[3])
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(decoded))
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
return 1`;

const REMOVE_SCRIPT = `-- image-cache-remove-v1
local raw = redis.call('HGET', KEYS[1], ARGV[1])
local size = 0
if raw then
  local ok, decoded = pcall(cjson.decode, raw)
  if ok and type(decoded) == 'table' then
    if ARGV[2] ~= '' and decoded.relativePath ~= ARGV[2] then return '' end
    size = tonumber(decoded.sizeBytes) or 0
  end
end
redis.call('DEL', ARGV[1])
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
if raw then
  local bytes = math.max(0, tonumber(redis.call('HGET', KEYS[3], 'bytes') or '0') - size)
  local entries = math.max(0, tonumber(redis.call('HGET', KEYS[3], 'entries') or '0') - 1)
  redis.call('HSET', KEYS[3], 'bytes', bytes, 'entries', entries)
end
return raw or ''`;

const RELEASE_LOCK_SCRIPT = `-- image-cache-release-lock-v1
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

const RENEW_MAINTENANCE_LOCK_SCRIPT = `-- image-cache-renew-maintenance-lock-v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1`;

const RENEW_FILL_LOCK_SCRIPT = `-- image-cache-renew-fill-lock-v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1`;

const RATE_LIMIT_SCRIPT = `-- image-cache-rate-limit-v2
local now = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local refillPerMs = tonumber(ARGV[3])
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens') or tostring(burst))
local updatedAt = tonumber(redis.call('HGET', KEYS[1], 'updatedAt') or tostring(now))
tokens = math.min(burst, tokens + math.max(0, now - updatedAt) * refillPerMs)
local allowed = 0
local retryMs = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
elseif refillPerMs > 0 then
  retryMs = math.ceil((1 - tokens) / refillPerMs)
else
  retryMs = 60000
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updatedAt', now)
local lifetime = math.max(60000, math.ceil((burst / math.max(refillPerMs, 0.000001)) * 2))
redis.call('PEXPIRE', KEYS[1], lifetime)
return {tostring(allowed), tostring(retryMs)}`;

const OBSERVE_SCRIPT = `-- image-cache-observe-v1
if ARGV[1] ~= '' then
  local current = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
  local increment = tonumber(ARGV[2]) or 1
  redis.call('HSET', KEYS[1], ARGV[1], math.min(tonumber(ARGV[3]), current + increment))
end
redis.call(
  'HSET',
  KEYS[1],
  'lastOutcome', ARGV[4],
  'lastValidatedBytes', ARGV[5],
  'lastDetectedFormat', ARGV[6],
  'lastCacheStatus', ARGV[7],
  'lastHost', ARGV[8]
)
return 1`;

const QUEUE_WAIT_SCRIPT = `-- image-cache-queue-wait-v1
local wait = tonumber(ARGV[1]) or 0
local count = tonumber(redis.call('HGET', KEYS[1], 'queueWaitCount') or '0')
local total = tonumber(redis.call('HGET', KEYS[1], 'queueWaitTotalMs') or '0')
local maximum = tonumber(redis.call('HGET', KEYS[1], 'queueWaitMaxMs') or '0')
redis.call(
  'HSET', KEYS[1],
  'queueWaitCount', math.min(tonumber(ARGV[2]), count + 1),
  'queueWaitTotalMs', math.min(tonumber(ARGV[2]), total + wait),
  'queueWaitMaxMs', math.max(maximum, wait)
)
local bucket = 'queueWaitGt15000'
if wait <= 100 then bucket = 'queueWaitLe100'
elseif wait <= 500 then bucket = 'queueWaitLe500'
elseif wait <= 1000 then bucket = 'queueWaitLe1000'
elseif wait <= 5000 then bucket = 'queueWaitLe5000'
elseif wait <= 15000 then bucket = 'queueWaitLe15000'
end
local bucketCount = tonumber(redis.call('HGET', KEYS[1], bucket) or '0')
redis.call('HSET', KEYS[1], bucket, math.min(tonumber(ARGV[2]), bucketCount + 1))
return 1`;

const RECONCILE_SCRIPT = `-- image-cache-reconcile-v1
if redis.call('GET', KEYS[5]) ~= ARGV[5] then
  return {'LOCK_LOST'}
end
if redis.call('GET', KEYS[6]) ~= ARGV[7] then
  return {'GENERATION_CHANGED'}
end
redis.call('PEXPIRE', KEYS[5], ARGV[6])
local entries = cjson.decode(ARGV[1])
local deleteKeys = cjson.decode(ARGV[2])
for _, key in ipairs(deleteKeys) do redis.call('DEL', key) end
redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
local bytes = 0
for _, entry in ipairs(entries) do
  redis.call('HSET', KEYS[1], entry.entryKey, cjson.encode(entry))
  redis.call('ZADD', KEYS[2], entry.lastUsedAt, entry.entryKey)
  bytes = bytes + entry.sizeBytes
end
redis.call('HSET', KEYS[3], 'bytes', bytes, 'entries', #entries)
local evicted = tonumber(ARGV[3]) or 0
if evicted > 0 then
  local count = tonumber(redis.call('HGET', KEYS[4], 'evictions') or '0')
  redis.call('HSET', KEYS[4], 'evictions', math.min(tonumber(ARGV[4]), count + evicted))
end
return {'OK', tostring(bytes), tostring(#entries)}`;

const DELETE_GENERATION_SCRIPT = `-- image-cache-delete-generation-v1
local metadataKeys = cjson.decode(ARGV[1])
for _, key in ipairs(metadataKeys) do redis.call('DEL', key) end
redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
return #metadataKeys`;

function parseNonNegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseRequiredNonNegativeInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid Redis image-accounting ${field}`);
  }
  return parsed;
}

export class ImageQuotaLockLostError extends Error {
  constructor() {
    super('Image-cache quota lock was lost');
    this.name = 'ImageQuotaLockLostError';
  }
}

export class ImageCacheGenerationChangedError extends Error {
  constructor() {
    super('Image-cache generation changed before registration');
    this.name = 'ImageCacheGenerationChangedError';
  }
}

export function parseImageIndexEntry(raw: string | null): ImageIndexEntry | null {
  if (!raw || raw.length > 16_384) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ImageIndexEntry>;
    if (
      typeof parsed.entryKey !== 'string'
      || typeof parsed.relativePath !== 'string'
      || !Number.isSafeInteger(parsed.sizeBytes)
      || parsed.sizeBytes! < 0
      || !Number.isSafeInteger(parsed.lastUsedAt)
      || parsed.lastUsedAt! < 0
    ) {
      return null;
    }
    return parsed as ImageIndexEntry;
  } catch {
    return null;
  }
}

function quotaLockKey(generation: number): string {
  return `helprr:cache:lock:image-quota:v${generation}`;
}

function fillLockKey(generation: number, keyHash: string): string {
  return `helprr:cache:lock:image-fill:v${generation}:${keyHash}`;
}

function processingUserKey(userId: string | undefined): string {
  return `helprr:cache:image-processing:user:${sha256Hex(userId ?? 'anonymous')}`;
}

const IMAGE_PROCESSING_GLOBAL_KEY = 'helprr:cache:image-processing:global';

export async function acquireImageProcessingLease(
  redis: ImageAccountingRedis,
  userId: string | undefined,
): Promise<ImageProcessingLease | null> {
  const token = randomUUID();
  const userKey = processingUserKey(userId);
  const result = await redis.eval(ACQUIRE_PROCESSING_LEASE_SCRIPT, {
    keys: [IMAGE_PROCESSING_GLOBAL_KEY, userKey],
    arguments: [
      String(Date.now()),
      String(IMAGE_PROCESSING_GLOBAL_MAX),
      String(IMAGE_PROCESSING_PER_USER_MAX),
      String(IMAGE_PROCESSING_LEASE_TTL_MS),
      token,
    ],
  });
  return Number(result) === 1 ? { token, userKey } : null;
}

export async function releaseImageProcessingLease(
  redis: ImageAccountingRedis,
  lease: ImageProcessingLease,
): Promise<void> {
  await redis.eval(RELEASE_PROCESSING_LEASE_SCRIPT, {
    keys: [IMAGE_PROCESSING_GLOBAL_KEY, lease.userKey],
    arguments: [lease.token],
  });
}

export async function acquireImageQuotaLock(
  redis: ImageAccountingRedis,
  generation: number,
): Promise<string | null> {
  const token = randomUUID();
  const result = await redis.set(
    quotaLockKey(generation),
    token,
    ACQUIRE_QUOTA_LOCK_OPTIONS,
  );
  return result === 'OK' ? token : null;
}

export async function acquireImageMaintenanceLock(
  redis: ImageAccountingRedis,
  generation: number,
): Promise<string | null> {
  const token = randomUUID();
  const result = await redis.set(
    quotaLockKey(generation),
    token,
    ACQUIRE_MAINTENANCE_LOCK_OPTIONS,
  );
  return result === 'OK' ? token : null;
}

export async function acquireImageFillLock(
  redis: ImageAccountingRedis,
  generation: number,
  keyHash: string,
): Promise<string | null> {
  const token = randomUUID();
  const result = await redis.set(
    fillLockKey(generation, keyHash),
    token,
    ACQUIRE_FILL_LOCK_OPTIONS,
  );
  return result === 'OK' ? token : null;
}

export async function releaseImageQuotaLock(
  redis: ImageAccountingRedis,
  generation: number,
  token: string,
): Promise<void> {
  await redis.eval(RELEASE_LOCK_SCRIPT, {
    keys: [quotaLockKey(generation)],
    arguments: [token],
  });
}

export async function renewImageMaintenanceLock(
  redis: ImageAccountingRedis,
  generation: number,
  token: string,
): Promise<boolean> {
  const renewed = await redis.eval(RENEW_MAINTENANCE_LOCK_SCRIPT, {
    keys: [quotaLockKey(generation)],
    arguments: [token, String(IMAGE_MAINTENANCE_LOCK_TTL_MS)],
  });
  return Number(renewed) === 1;
}

export async function renewImageFillLock(
  redis: ImageAccountingRedis,
  generation: number,
  keyHash: string,
  token: string,
): Promise<boolean> {
  const renewed = await redis.eval(RENEW_FILL_LOCK_SCRIPT, {
    keys: [fillLockKey(generation, keyHash)],
    arguments: [token, String(CACHE_LOCK_TTL_MS)],
  });
  return Number(renewed) === 1;
}

export async function releaseImageFillLock(
  redis: ImageAccountingRedis,
  generation: number,
  keyHash: string,
  token: string,
): Promise<void> {
  await redis.eval(RELEASE_LOCK_SCRIPT, {
    keys: [fillLockKey(generation, keyHash)],
    arguments: [token],
  });
}

export async function registerImageCacheEntry(
  redis: ImageAccountingRedis,
  generation: number,
  entry: ImageIndexEntry,
  metadataJson: string,
  ttlSeconds: number,
  quotaLockToken: string,
): Promise<ImageQuotaMutation> {
  const indexKey = buildImageIndexKey(generation);
  const lruKey = buildImageLruKey(generation);
  const usageKey = buildImageUsageKey(generation);
  const registered = await redis.eval(REGISTER_SCRIPT, {
    keys: [
      entry.entryKey,
      indexKey,
      lruKey,
      usageKey,
      CACHE_GENERATION_KEY,
      quotaLockKey(generation),
      IMAGE_CACHE_OBSERVABILITY_KEY,
    ],
    arguments: [
      entry.entryKey,
      metadataJson,
      String(Math.max(1, ttlSeconds)),
      JSON.stringify(entry),
      String(entry.lastUsedAt),
      String(entry.sizeBytes),
      String(generation),
      quotaLockToken,
      String(IMAGE_QUOTA_LOCK_TTL_MS),
      String(IMAGE_CACHE_MAX_BYTES),
      String(IMAGE_CACHE_MAX_ENTRIES),
      String(MAX_COUNTER),
    ],
  });
  if (Array.isArray(registered) && registered[0] === 'GENERATION_CHANGED') {
    throw new ImageCacheGenerationChangedError();
  }
  if (Array.isArray(registered) && registered[0] === 'LOCK_LOST') {
    throw new ImageQuotaLockLostError();
  }
  if (!Array.isArray(registered) || registered.length < 4) {
    throw new Error('Invalid Redis image-accounting registration');
  }
  const values = registered;
  if (typeof values[0] !== 'string') {
    throw new Error('Invalid Redis image-accounting previous entry');
  }
  const previous = parseImageIndexEntry(typeof values[0] === 'string' ? values[0] : null);
  let rawEvicted: unknown;
  try {
    rawEvicted = JSON.parse(typeof values[1] === 'string' ? values[1] : '');
  } catch {
    throw new Error('Invalid Redis image-accounting eviction list');
  }
  if (!Array.isArray(rawEvicted)) {
    // cjson renders an empty Lua table as "{}". The script now sends '[]' for
    // that case, but accepting both keeps a version-skewed script from failing
    // a fill and discarding the image file that was just written.
    const isEmptyObject = typeof rawEvicted === 'object'
      && rawEvicted !== null
      && Object.keys(rawEvicted).length === 0;
    if (!isEmptyObject) {
      throw new Error('Invalid Redis image-accounting eviction list');
    }
    rawEvicted = [];
  }
  const evicted = (rawEvicted as unknown[])
    .map((raw) => parseImageIndexEntry(typeof raw === 'string' ? raw : null))
    .filter((value): value is ImageIndexEntry => value !== null);
  const bytes = parseRequiredNonNegativeInteger(values[2], 'byte count');
  const entries = parseRequiredNonNegativeInteger(values[3], 'entry count');

  return { previous, evicted, bytes, entries };
}

export async function touchImageCacheEntry(
  redis: ImageAccountingRedis,
  generation: number,
  entryKey: string,
  relativePath: string,
  nowMs: number,
): Promise<void> {
  await redis.eval(TOUCH_SCRIPT, {
    keys: [buildImageIndexKey(generation), buildImageLruKey(generation)],
    arguments: [entryKey, relativePath, String(nowMs)],
  });
}

export async function removeImageCacheEntry(
  redis: ImageAccountingRedis,
  generation: number,
  entryKey: string,
  expectedRelativePath?: string,
): Promise<ImageIndexEntry | null> {
  const result = await redis.eval(REMOVE_SCRIPT, {
    keys: [
      buildImageIndexKey(generation),
      buildImageLruKey(generation),
      buildImageUsageKey(generation),
    ],
    arguments: [entryKey, expectedRelativePath ?? ''],
  });
  return parseImageIndexEntry(typeof result === 'string' ? result : null);
}

export async function enforceImageFetchRateLimit(
  redis: ImageAccountingRedis,
  userId: string | undefined,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  if (!userId) return { allowed: true, retryAfterSeconds: 0 };
  const key = `helprr:cache:image-fetch-rate:${sha256Hex(userId)}`;
  const refillPerMs = IMAGE_FETCH_RATE_REFILL_PER_MINUTE / 60_000;
  const result = await redis.eval(RATE_LIMIT_SCRIPT, {
    keys: [key],
    arguments: [
      String(Date.now()),
      String(IMAGE_FETCH_RATE_BURST),
      String(refillPerMs),
    ],
  });
  const values = Array.isArray(result) ? result : [];
  const allowed = Number(values[0]) === 1;
  const retryMs = parseNonNegativeInteger(values[1]);
  return {
    allowed,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(retryMs / 1000)),
  };
}

export async function recordImageObservation(
  redis: ImageAccountingRedis,
  observation: ImageObservation,
): Promise<void> {
  const validatedBytes = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(0, Math.trunc(observation.validatedBytes)),
  );
  await redis.eval(OBSERVE_SCRIPT, {
    keys: [IMAGE_CACHE_OBSERVABILITY_KEY],
    arguments: [
      observation.counter ?? '',
      String(Math.max(1, Math.trunc(observation.increment ?? 1))),
      String(MAX_COUNTER),
      observation.outcome,
      String(validatedBytes),
      (observation.format ?? '').slice(0, 16),
      observation.cacheStatus.slice(0, 16),
      observation.host.toLowerCase().slice(0, 255),
    ],
  });
}

export async function recordImageQueueWait(
  redis: ImageAccountingRedis,
  waitMs: number,
): Promise<void> {
  await redis.eval(QUEUE_WAIT_SCRIPT, {
    keys: [IMAGE_CACHE_OBSERVABILITY_KEY],
    arguments: [
      String(Math.max(0, Math.min(MAX_COUNTER, Math.trunc(waitMs)))),
      String(MAX_COUNTER),
    ],
  });
}

export async function reconcileImageCacheAccounting(
  redis: ImageAccountingRedis,
  generation: number,
  entries: ImageIndexEntry[],
  metadataKeysToDelete: string[],
  evictionCount: number,
  quotaLockToken: string,
): Promise<{ bytes: number; entries: number }> {
  const result = await redis.eval(RECONCILE_SCRIPT, {
    keys: [
      buildImageIndexKey(generation),
      buildImageLruKey(generation),
      buildImageUsageKey(generation),
      IMAGE_CACHE_OBSERVABILITY_KEY,
      quotaLockKey(generation),
      CACHE_GENERATION_KEY,
    ],
    arguments: [
      JSON.stringify(entries),
      JSON.stringify(metadataKeysToDelete),
      String(Math.max(0, Math.trunc(evictionCount))),
      String(MAX_COUNTER),
      quotaLockToken,
      String(IMAGE_MAINTENANCE_LOCK_TTL_MS),
      String(generation),
    ],
  });
  if (Array.isArray(result) && result[0] === 'LOCK_LOST') {
    throw new ImageQuotaLockLostError();
  }
  if (Array.isArray(result) && result[0] === 'GENERATION_CHANGED') {
    throw new ImageCacheGenerationChangedError();
  }
  if (
    !Array.isArray(result)
    || result.length < 3
    || result[0] !== 'OK'
  ) {
    throw new Error('Invalid Redis image-accounting reconciliation');
  }
  const values = result;
  return {
    bytes: parseRequiredNonNegativeInteger(values[1], 'reconciled byte count'),
    entries: parseRequiredNonNegativeInteger(values[2], 'reconciled entry count'),
  };
}

export async function deleteImageGenerationAccounting(
  redis: ImageAccountingRedis,
  generation: number,
  metadataKeys: string[],
): Promise<void> {
  await redis.eval(DELETE_GENERATION_SCRIPT, {
    keys: [
      buildImageIndexKey(generation),
      buildImageLruKey(generation),
      buildImageUsageKey(generation),
    ],
    arguments: [JSON.stringify(metadataKeys)],
  });
}

function diagnosticCounter(values: Record<string, string>, field: string): number {
  return parseNonNegativeInteger(values[field]);
}

function queueWaitPercentile(
  observations: Record<string, string>,
  percentile: number,
): number {
  const buckets = [
    ['queueWaitLe100', 100],
    ['queueWaitLe500', 500],
    ['queueWaitLe1000', 1_000],
    ['queueWaitLe5000', 5_000],
    ['queueWaitLe15000', 15_000],
    ['queueWaitGt15000', diagnosticCounter(observations, 'queueWaitMaxMs')],
  ] as const;
  const count = diagnosticCounter(observations, 'queueWaitCount');
  if (count === 0) return 0;
  const target = Math.max(1, Math.ceil(count * percentile));
  let seen = 0;
  for (const [field, upperBound] of buckets) {
    seen += diagnosticCounter(observations, field);
    if (seen >= target) return upperBound;
  }
  return diagnosticCounter(observations, 'queueWaitMaxMs');
}

export async function getImageCacheDiagnostics(
  redis: ImageAccountingRedis,
  generation: number,
  runtime: Partial<Pick<
    ImageCacheDiagnostics,
    | 'health'
    | 'healthCheckedAt'
    | 'queueDepth'
    | 'currentRunning'
    | 'maxQueueDepth'
    | 'maxRunning'
  >> = {},
): Promise<ImageCacheDiagnostics> {
  const [usage, observations] = await Promise.all([
    redis.hGetAll(buildImageUsageKey(generation)),
    redis.hGetAll(IMAGE_CACHE_OBSERVABILITY_KEY),
  ]);
  const lastValidatedBytes = observations.lastValidatedBytes;
  return {
    accountingAvailable: true,
    health: runtime.health ?? 'healthy',
    healthCheckedAt: runtime.healthCheckedAt ?? null,
    queueDepth: runtime.queueDepth ?? 0,
    currentRunning: runtime.currentRunning ?? 0,
    maxQueueDepth: runtime.maxQueueDepth ?? IMAGE_PROCESSING_QUEUE_MAX,
    maxRunning: runtime.maxRunning ?? 16,
    queueWaitLimitMs: IMAGE_PROCESSING_QUEUE_WAIT_MS,
    rateBurst: IMAGE_FETCH_RATE_BURST,
    rateRefillPerMinute: IMAGE_FETCH_RATE_REFILL_PER_MINUTE,
    quotaBytes: diagnosticCounter(usage, 'bytes'),
    quotaEntries: diagnosticCounter(usage, 'entries'),
    maxBytes: IMAGE_CACHE_MAX_BYTES,
    maxEntries: IMAGE_CACHE_MAX_ENTRIES,
    evictions: diagnosticCounter(observations, 'evictions'),
    oversizedRejections: diagnosticCounter(observations, 'oversizedRejections'),
    invalidImageRejections: diagnosticCounter(observations, 'invalidImageRejections'),
    upstreamFetches: diagnosticCounter(observations, 'upstreamFetches'),
    cacheHits: diagnosticCounter(observations, 'cacheHits'),
    cacheBypasses: diagnosticCounter(observations, 'cacheBypasses'),
    healthyBypasses: diagnosticCounter(observations, 'healthyBypasses'),
    registrations: diagnosticCounter(observations, 'registrations'),
    staleResponses: diagnosticCounter(observations, 'staleResponses'),
    trueMisses: diagnosticCounter(observations, 'trueMisses'),
    queueCapacityRejections: diagnosticCounter(observations, 'queueCapacityRejections'),
    clientAborts: diagnosticCounter(observations, 'clientAborts'),
    upstreamTimeouts: diagnosticCounter(observations, 'upstreamTimeouts'),
    upstreamErrors: diagnosticCounter(observations, 'upstreamErrors'),
    rateLimitRejections: diagnosticCounter(observations, 'rateLimitRejections'),
    quotaLockWaits: diagnosticCounter(observations, 'quotaLockWaits'),
    quotaLockTimeouts: diagnosticCounter(observations, 'quotaLockTimeouts'),
    missingFileRecoveries: diagnosticCounter(observations, 'missingFileRecoveries'),
    backgroundRevalidationsStarted: diagnosticCounter(
      observations,
      'backgroundRevalidationsStarted',
    ),
    backgroundRevalidationsSucceeded: diagnosticCounter(
      observations,
      'backgroundRevalidationsSucceeded',
    ),
    backgroundRevalidationsFailed: diagnosticCounter(
      observations,
      'backgroundRevalidationsFailed',
    ),
    queueWaitP50Ms: queueWaitPercentile(observations, 0.5),
    queueWaitP95Ms: queueWaitPercentile(observations, 0.95),
    queueWaitMaxMs: diagnosticCounter(observations, 'queueWaitMaxMs'),
    lastOutcome: observations.lastOutcome || null,
    lastValidatedBytes: lastValidatedBytes === undefined
      ? null
      : diagnosticCounter(observations, 'lastValidatedBytes'),
    lastDetectedFormat: observations.lastDetectedFormat || null,
    lastCacheStatus: observations.lastCacheStatus || null,
    lastHost: observations.lastHost || null,
  };
}

export function unavailableImageCacheDiagnostics(
  runtime: Partial<Pick<
    ImageCacheDiagnostics,
    | 'health'
    | 'healthCheckedAt'
    | 'queueDepth'
    | 'currentRunning'
    | 'maxQueueDepth'
    | 'maxRunning'
  >> = {},
): ImageCacheDiagnostics {
  return {
    accountingAvailable: false,
    health: runtime.health ?? 'accounting-unavailable',
    healthCheckedAt: runtime.healthCheckedAt ?? null,
    queueDepth: runtime.queueDepth ?? 0,
    currentRunning: runtime.currentRunning ?? 0,
    maxQueueDepth: runtime.maxQueueDepth ?? IMAGE_PROCESSING_QUEUE_MAX,
    maxRunning: runtime.maxRunning ?? 16,
    queueWaitLimitMs: IMAGE_PROCESSING_QUEUE_WAIT_MS,
    rateBurst: IMAGE_FETCH_RATE_BURST,
    rateRefillPerMinute: IMAGE_FETCH_RATE_REFILL_PER_MINUTE,
    quotaBytes: null,
    quotaEntries: null,
    maxBytes: IMAGE_CACHE_MAX_BYTES,
    maxEntries: IMAGE_CACHE_MAX_ENTRIES,
    evictions: null,
    oversizedRejections: null,
    invalidImageRejections: null,
    upstreamFetches: null,
    cacheHits: null,
    cacheBypasses: null,
    healthyBypasses: null,
    registrations: null,
    staleResponses: null,
    trueMisses: null,
    queueCapacityRejections: null,
    clientAborts: null,
    upstreamTimeouts: null,
    upstreamErrors: null,
    rateLimitRejections: null,
    quotaLockWaits: null,
    quotaLockTimeouts: null,
    missingFileRecoveries: null,
    backgroundRevalidationsStarted: null,
    backgroundRevalidationsSucceeded: null,
    backgroundRevalidationsFailed: null,
    queueWaitP50Ms: null,
    queueWaitP95Ms: null,
    queueWaitMaxMs: null,
    lastOutcome: null,
    lastValidatedBytes: null,
    lastDetectedFormat: null,
    lastCacheStatus: null,
    lastHost: null,
  };
}
