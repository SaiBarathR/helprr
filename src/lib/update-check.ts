import { getRedisClient } from '@/lib/redis';

const RELEASES_API_URL = 'https://api.github.com/repos/saibarathr/helprr/releases/latest';
const RELEASES_WEB_URL = 'https://github.com/saibarathr/helprr/releases/tag/';
const CACHE_KEY = 'helprr:update-check:latest-stable';
const CACHE_TTL_SECONDS = 6 * 60 * 60;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_CHARS = 128_000;

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export interface LatestRelease {
  version: string;
  tagName: string;
  publishedAt: string | null;
}

export type UpdateCheckStatus =
  | 'update_available'
  | 'up_to_date'
  | 'development'
  | 'unavailable';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
}

interface UpdateCheckDependencies {
  loadLatestRelease?: () => Promise<LatestRelease>;
  now?: () => Date;
}

interface CachedRelease extends LatestRelease {
  cachedAt: number;
}

let memoryCache: CachedRelease | null = null;

export function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    value.trim(),
  );
  if (!match) return null;

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;

  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((part) => part.length === 0)) return null;
  return { major, minor, patch, prerelease };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;

    const aNumeric = /^[0-9]+$/.test(a);
    const bNumeric = /^[0-9]+$/.test(b);
    if (aNumeric && bNumeric) return Number.parseInt(a, 10) - Number.parseInt(b, 10);
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return a.localeCompare(b);
  }
  return 0;
}

export function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  for (const field of ['major', 'minor', 'patch'] as const) {
    if (left[field] !== right[field]) return left[field] - right[field];
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function validLatestRelease(value: unknown): LatestRelease | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<LatestRelease>;
  if (
    typeof candidate.version !== 'string'
    || typeof candidate.tagName !== 'string'
    || !parseSemanticVersion(candidate.version)
    || !parseSemanticVersion(candidate.tagName)
  ) {
    return null;
  }
  return {
    version: candidate.version,
    tagName: candidate.tagName,
    publishedAt: typeof candidate.publishedAt === 'string' ? candidate.publishedAt : null,
  };
}

async function readCachedRelease(nowMs: number): Promise<LatestRelease | null> {
  if (memoryCache && nowMs - memoryCache.cachedAt < CACHE_TTL_SECONDS * 1000) {
    return memoryCache;
  }

  try {
    const redis = await getRedisClient();
    const raw = await redis.get(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedRelease>;
    const release = validLatestRelease(parsed);
    if (
      !release
      || typeof parsed.cachedAt !== 'number'
      || nowMs - parsed.cachedAt >= CACHE_TTL_SECONDS * 1000
    ) return null;
    memoryCache = { ...release, cachedAt: parsed.cachedAt };
    return release;
  } catch {
    return null;
  }
}

async function cacheRelease(release: LatestRelease, nowMs: number): Promise<void> {
  memoryCache = { ...release, cachedAt: nowMs };
  try {
    const redis = await getRedisClient();
    await redis.set(CACHE_KEY, JSON.stringify(memoryCache), { EX: CACHE_TTL_SECONDS });
  } catch {
    // The in-process cache still prevents repeated checks in this server bundle.
  }
}

export async function fetchLatestStableRelease(fetchImpl: typeof fetch = fetch): Promise<LatestRelease> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Helprr-update-check',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub release check failed (${response.status})`);

    const body = await response.text();
    if (body.length > MAX_RESPONSE_CHARS) throw new Error('GitHub release response was too large');
    const parsed = JSON.parse(body) as { tag_name?: unknown; published_at?: unknown };
    if (typeof parsed.tag_name !== 'string' || !parseSemanticVersion(parsed.tag_name)) {
      throw new Error('GitHub release response did not contain a semantic version');
    }

    return {
      version: parsed.tag_name.replace(/^v/, ''),
      tagName: parsed.tag_name,
      publishedAt: typeof parsed.published_at === 'string' ? parsed.published_at : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadLatestRelease(nowMs: number): Promise<LatestRelease> {
  const cached = await readCachedRelease(nowMs);
  if (cached) return cached;
  const release = await fetchLatestStableRelease();
  await cacheRelease(release, nowMs);
  return release;
}

export async function checkForUpdates(
  currentVersion: string,
  dependencies: UpdateCheckDependencies = {},
): Promise<UpdateCheckResult> {
  const current = parseSemanticVersion(currentVersion);
  if (!current) {
    return {
      status: 'development',
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      publishedAt: null,
      checkedAt: null,
    };
  }

  const now = dependencies.now?.() ?? new Date();
  try {
    const latest = await (dependencies.loadLatestRelease ?? (() => loadLatestRelease(now.getTime())))();
    const parsedLatest = parseSemanticVersion(latest.version);
    if (!parsedLatest) throw new Error('Latest release version was invalid');

    return {
      status: compareSemanticVersions(current, parsedLatest) < 0
        ? 'update_available'
        : 'up_to_date',
      currentVersion,
      latestVersion: latest.version,
      releaseUrl: `${RELEASES_WEB_URL}${encodeURIComponent(latest.tagName)}`,
      publishedAt: latest.publishedAt,
      checkedAt: now.toISOString(),
    };
  } catch {
    return {
      status: 'unavailable',
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      publishedAt: null,
      checkedAt: now.toISOString(),
    };
  }
}
