import fs from 'fs';
import path from 'path';
import readline from 'readline';
import util from 'util';
import { formatInTimeZone, getEnvTimeZone, normalizeTimeZone } from '@/lib/timezone';
import {
  DEFAULT_LOG_LEVEL,
  DEFAULT_LOG_MAX_FILE_MB,
  DEFAULT_LOG_RETENTION_DAYS,
} from '@/lib/app-settings';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerConfig {
  timeZone: string;
  level: LogLevel;
  maxFileMb: number;
  retentionDays: number;
  enabled: boolean;
}

export interface LogEntry {
  timestampUtc: string;
  timestampLocal: string;
  timeZone: string;
  level: LogLevel;
  source: 'server' | 'client' | 'service-worker';
  scope?: string;
  requestId?: string;
  message: string;
  metadata?: unknown;
}

export interface LogFileInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface LogSearchFilters {
  q?: string;
  level?: string | string[];
  source?: string | string[];
  file?: string;
  from?: string;
  to?: string;
  limit?: number;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LOG_FILE = 'helprr.jsonl';
const MAX_LOG_VALUE_LENGTH = 8_000;
const MAX_SEARCH_LINE_LENGTH = 500_000;
const EXACT_SENSITIVE_KEYS = new Set([
  'endpoint', 'auth', 'authorization', 'cookie', 'session', 'p256dh',
  'password', 'passwd', 'pwd', 'secret', 'token', 'jwt',
  'vapid', 'vapidsubject', 'vapidpublickey', 'vapidprivatekey',
]);
const SUBSTRING_SENSITIVE_PATTERN = /api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token/i;
const SENSITIVE_VALUE_PATTERN = /(Bearer\s+)[^\s,;]+|(api[_-]?key=)[^&\s]+|(apikey=)[^&\s]+|(password=)[^&\s]+|(token=)[^&\s]+|(sid=)[^;&\s]+|(code=)[^&\s]+|(state=)[^&\s]+/gi;

const originalConsole = {
  debug: console.debug.bind(console),
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

// Next.js with webpack splits instrumentation, polling, and per-route API handlers
// into separate bundles. Each bundle would otherwise get its own copy of this
// module's mutable state, so configureLogger() called from one bundle would not
// affect logger.X() callers in another. We stash the live config on globalThis so
// every bundle reads and writes the same object.
type LoggerSingleton = {
  config: LoggerConfig;
  writeQueue: Promise<void>;
  initialized: boolean;
  cleaning: boolean;
};

const SINGLETON_KEY = '__helprrLogger' as const;
const globalScope = globalThis as typeof globalThis & {
  [SINGLETON_KEY]?: LoggerSingleton;
};

const singleton: LoggerSingleton = globalScope[SINGLETON_KEY] ?? {
  config: {
    timeZone: getEnvTimeZone(),
    level: DEFAULT_LOG_LEVEL as LogLevel,
    maxFileMb: DEFAULT_LOG_MAX_FILE_MB,
    retentionDays: DEFAULT_LOG_RETENTION_DAYS,
    enabled: true,
  },
  writeQueue: Promise.resolve(),
  initialized: false,
  cleaning: false,
};
globalScope[SINGLETON_KEY] = singleton;

function getLogDir(): string {
  return process.env.LOG_DIR || path.join(process.cwd(), 'logs');
}

function getCurrentLogPath(): string {
  return path.join(getLogDir(), LOG_FILE);
}

function normalizeLevel(level: unknown): LogLevel {
  return level === 'debug' || level === 'info' || level === 'warn' || level === 'error'
    ? level
    : (DEFAULT_LOG_LEVEL as LogLevel);
}

function shouldWrite(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[singleton.config.level];
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function configureLogger(next: Partial<LoggerConfig>): void {
  singleton.config.timeZone = normalizeTimeZone(next.timeZone, singleton.config.timeZone);
  singleton.config.level = normalizeLevel(next.level ?? singleton.config.level);
  singleton.config.maxFileMb = clampInt(next.maxFileMb, singleton.config.maxFileMb, 1, 1024);
  singleton.config.retentionDays = clampInt(next.retentionDays, singleton.config.retentionDays, 1, 3650);
  singleton.config.enabled = next.enabled === undefined ? singleton.config.enabled : Boolean(next.enabled);
}

function redactString(value: string): string {
  return value.replace(SENSITIVE_VALUE_PATTERN, (_match, bearer, apiKey, apikey, password, token, sid, code, state) => {
    const prefix = bearer || apiKey || apikey || password || token || sid || code || state || '';
    return `${prefix}[REDACTED]`;
  });
}

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (depth > 8) return '[MaxDepth]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => redact(item, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    const lower = key.toLowerCase();
    const isSensitive = EXACT_SENSITIVE_KEYS.has(lower) || SUBSTRING_SENSITIVE_PATTERN.test(key);
    output[key] = isSensitive ? '[REDACTED]' : redact(item, depth + 1, seen);
  }
  return output;
}

function stringifyForMessage(value: unknown): string {
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) return redactString(value.stack || value.message);
  return redactString(util.inspect(redact(value), { depth: 4, breakLength: 160, maxArrayLength: 50 }));
}

function buildConsolePayload(args: unknown[]) {
  const [first, ...rest] = args;
  return {
    message: stringifyForMessage(first),
    metadata: rest.length > 0 ? { args: rest.map((arg) => redact(arg)) } : undefined,
  };
}

function serializeEntry(entry: LogEntry): string {
  const json = JSON.stringify(redact(entry));
  if (json.length <= MAX_LOG_VALUE_LENGTH) return json;
  return JSON.stringify({
    ...entry,
    metadata: '[TRUNCATED]',
    message: entry.message.slice(0, MAX_LOG_VALUE_LENGTH),
  });
}

function rotatedName(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `helprr-${stamp}.jsonl`;
}

async function rotateIfNeeded(bytesToWrite: number): Promise<void> {
  const logPath = getCurrentLogPath();
  const maxBytes = singleton.config.maxFileMb * 1024 * 1024;
  try {
    const stat = await fs.promises.stat(logPath);
    if (stat.size + bytesToWrite < maxBytes) return;
    await fs.promises.rename(logPath, path.join(getLogDir(), rotatedName()));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      originalConsole.warn('[Logger] Rotation failed:', error);
    }
  }
}

async function cleanupOldLogs(): Promise<void> {
  if (singleton.cleaning) return;
  singleton.cleaning = true;
  try {
    const cutoff = Date.now() - singleton.config.retentionDays * 24 * 60 * 60 * 1000;
    const dir = getLogDir();
    const files = await fs.promises.readdir(dir).catch(() => []);
    await Promise.all(files
      .filter((file) => file.startsWith('helprr-') && file.endsWith('.jsonl'))
      .map(async (file) => {
        const fullPath = path.join(dir, file);
        const stat = await fs.promises.stat(fullPath).catch(() => null);
        if (stat && stat.mtimeMs < cutoff) {
          await fs.promises.unlink(fullPath).catch(() => {});
        }
      }));
  } finally {
    singleton.cleaning = false;
  }
}

async function appendEntry(entry: LogEntry): Promise<void> {
  const dir = getLogDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const line = `${serializeEntry(entry)}\n`;
  await rotateIfNeeded(Buffer.byteLength(line));
  await fs.promises.appendFile(getCurrentLogPath(), line, 'utf8');
  void cleanupOldLogs();
}

export function writeLog(
  level: LogLevel,
  message: string,
  metadata?: unknown,
  options: Partial<Pick<LogEntry, 'source' | 'scope' | 'requestId'>> = {}
): void {
  if (!singleton.config.enabled) return;
  const normalizedLevel = normalizeLevel(level);
  if (!shouldWrite(normalizedLevel)) return;

  const now = new Date();
  const timeZone = normalizeTimeZone(singleton.config.timeZone);
  const entry: LogEntry = {
    timestampUtc: now.toISOString(),
    timestampLocal: formatInTimeZone(now, timeZone, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: false,
      timeZoneName: 'short',
    }),
    timeZone,
    level: normalizedLevel,
    source: options.source ?? 'server',
    scope: options.scope,
    requestId: options.requestId,
    message: redactString(message),
    metadata: metadata === undefined ? undefined : redact(metadata),
  };

  singleton.writeQueue = singleton.writeQueue.then(() => appendEntry(entry)).catch((error) => {
    originalConsole.warn('[Logger] Write failed:', error);
  });
}

export const logger = {
  debug: (message: string, metadata?: unknown, options?: Partial<Pick<LogEntry, 'source' | 'scope' | 'requestId'>>) =>
    writeLog('debug', message, metadata, options),
  info: (message: string, metadata?: unknown, options?: Partial<Pick<LogEntry, 'source' | 'scope' | 'requestId'>>) =>
    writeLog('info', message, metadata, options),
  warn: (message: string, metadata?: unknown, options?: Partial<Pick<LogEntry, 'source' | 'scope' | 'requestId'>>) =>
    writeLog('warn', message, metadata, options),
  error: (message: string, metadata?: unknown, options?: Partial<Pick<LogEntry, 'source' | 'scope' | 'requestId'>>) =>
    writeLog('error', message, metadata, options),
};

export function initializeServerLogging(next?: Partial<LoggerConfig>): void {
  if (next) configureLogger(next);
  if (singleton.initialized) return;
  singleton.initialized = true;

  console.debug = (...args: unknown[]) => {
    originalConsole.debug(...args);
    const payload = buildConsolePayload(args);
    writeLog('debug', payload.message, payload.metadata, { scope: 'console' });
  };
  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    const payload = buildConsolePayload(args);
    writeLog('info', payload.message, payload.metadata, { scope: 'console' });
  };
  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    const payload = buildConsolePayload(args);
    writeLog('info', payload.message, payload.metadata, { scope: 'console' });
  };
  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    const payload = buildConsolePayload(args);
    writeLog('warn', payload.message, payload.metadata, { scope: 'console' });
  };
  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    const payload = buildConsolePayload(args);
    writeLog('error', payload.message, payload.metadata, { scope: 'console' });
  };

  process.on('uncaughtException', (error) => {
    writeLog('error', 'Uncaught exception', error, { scope: 'process' });
    void flushPendingWrites().finally(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    writeLog('error', 'Unhandled rejection', reason, { scope: 'process' });
    void flushPendingWrites().finally(() => process.exit(1));
  });
}

export async function flushPendingWrites(): Promise<void> {
  try {
    await singleton.writeQueue;
  } catch {
    // Errors are already surfaced via the queue's catch handler.
  }
}

function assertSafeLogFile(file: string): string {
  if (!/^helprr(?:-[A-Za-z0-9_.-]+)?\.jsonl$/.test(file)) {
    throw new Error('Invalid log file');
  }
  return path.join(getLogDir(), file);
}

export async function listLogFiles(): Promise<LogFileInfo[]> {
  const dir = getLogDir();
  const files = await fs.promises.readdir(dir).catch(() => []);
  const infos = await Promise.all(files
    .filter((file) => file === LOG_FILE || (file.startsWith('helprr-') && file.endsWith('.jsonl')))
    .map(async (file) => {
      const stat = await fs.promises.stat(path.join(dir, file));
      return {
        name: file,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    }));
  return infos.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
}

export function getSafeLogFilePath(file: string): string {
  return assertSafeLogFile(file);
}

export async function deleteLogFile(file: string): Promise<void> {
  const fullPath = assertSafeLogFile(file);
  await fs.promises.unlink(fullPath);
}

function filterMatches(filter: string | string[] | undefined, value: string): boolean {
  if (!filter) return true;
  if (Array.isArray(filter)) return filter.length === 0 || filter.includes(value);
  return filter === value;
}

function matchesFilters(entry: LogEntry, filters: LogSearchFilters): boolean {
  if (!filterMatches(filters.level, entry.level)) return false;
  if (!filterMatches(filters.source, entry.source)) return false;
  const entryTime = Date.parse(entry.timestampUtc);
  if (filters.from && entryTime < Date.parse(filters.from)) return false;
  if (filters.to && entryTime > Date.parse(filters.to)) return false;
  if (filters.q) {
    const haystack = `${entry.message} ${JSON.stringify(entry.metadata ?? {})}`.toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

async function streamMatchesFromFile(
  fullPath: string,
  filters: LogSearchFilters,
  limit: number
): Promise<LogEntry[]> {
  const ring: LogEntry[] = [];
  const stream = fs.createReadStream(fullPath, { encoding: 'utf8' });
  stream.on('error', () => {
    // The readline interface will close; the caller treats this as zero matches.
  });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line || line.length > MAX_SEARCH_LINE_LENGTH) continue;
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (!matchesFilters(entry, filters)) continue;
      ring.push(entry);
      if (ring.length > limit) ring.shift();
    } catch {
      // Ignore malformed partial lines from interrupted writes.
    }
  }
  return ring.reverse();
}

export async function streamFilteredLogs(
  filters: LogSearchFilters,
  onLine: (line: string) => void | Promise<void>
): Promise<void> {
  const files = filters.file
    ? [filters.file]
    : (await listLogFiles()).map((file) => file.name);

  for (const file of files) {
    const fullPath = assertSafeLogFile(file);
    const stream = fs.createReadStream(fullPath, { encoding: 'utf8' });
    stream.on('error', () => {
      // Skip unreadable files; readline will close.
    });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of reader) {
        if (!line || line.length > MAX_SEARCH_LINE_LENGTH) continue;
        try {
          const entry = JSON.parse(line) as LogEntry;
          if (!matchesFilters(entry, filters)) continue;
          await onLine(line);
        } catch {
          // Skip malformed lines.
        }
      }
    } finally {
      reader.close();
      stream.destroy();
    }
  }
}

export async function searchLogs(filters: LogSearchFilters): Promise<LogEntry[]> {
  const limit = clampInt(filters.limit, 200, 1, 1_000);
  const files = filters.file
    ? [filters.file]
    : (await listLogFiles()).map((file) => file.name);
  const matches: LogEntry[] = [];

  for (const file of files) {
    const fullPath = assertSafeLogFile(file);
    const fileMatches = await streamMatchesFromFile(fullPath, filters, limit).catch(() => []);
    for (const entry of fileMatches) {
      matches.push(entry);
      if (matches.length >= limit) return matches;
    }
  }

  return matches;
}
