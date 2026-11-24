// The admin-only routes under /api/admin/arr-system: one Sonarr, Radarr,
// Lidarr or Prowlarr instance's version, scheduled tasks and recent warnings.
// Every answer is rebuilt from a few fields, and every text the app wrote is
// redacted, so nothing else it returns (paths of its own config, keys) reaches
// the browser.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getLidarrClient, getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { ProwlarrClient } from '@/lib/prowlarr-client';
import { redactProwlarrText } from '@/lib/prowlarr-redact';
import {
  ARR_LOG_PAGE_SIZE,
  isSystemServiceType,
  type ArrLogEntry,
  type ArrLogPage,
  type ArrSystemStatus,
  type ArrSystemTask,
  type SystemServiceType,
} from '@/lib/arr-system';

export const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

interface CommandResult {
  id: number;
  name: string;
  status: string;
}

/** What these routes need of each app's client; all four have it. */
interface SystemClient {
  getSystemStatus(): Promise<unknown>;
  getUpdates(): Promise<unknown[]>;
  getSystemTasks(): Promise<unknown[]>;
  getLogs(params: { page: number; pageSize: number; level: string }): Promise<unknown>;
  runTask(name: string): Promise<CommandResult>;
  getCommand(id: number): Promise<CommandResult>;
}

export interface SystemTarget {
  type: SystemServiceType;
  instanceId: string;
  client: SystemClient;
  /** Only to blank it out of log text; never sent anywhere. */
  apiKey: string;
}

/**
 * The instance a request names. `instanceId` is required and must be a
 * Sonarr, Radarr, Lidarr or Prowlarr connection: the app is the instance's
 * own type, never the default instance of another.
 */
export async function resolveSystemTarget(
  instanceId: unknown,
): Promise<{ ok: true; target: SystemTarget } | { ok: false; response: NextResponse }> {
  if (typeof instanceId !== 'string' || !instanceId.trim() || instanceId.length > 128) {
    return { ok: false, response: NextResponse.json({ error: 'instanceId is required' }, { status: 400 }) };
  }
  const id = instanceId.trim();
  const connection = await prisma.serviceConnection.findUnique({ where: { id } });
  if (!connection || !isSystemServiceType(connection.type)) {
    return { ok: false, response: NextResponse.json({ error: 'Instance not found' }, { status: 404 }) };
  }
  const type = connection.type;
  // Prowlarr is a single instance, so its helper takes no id: build the client
  // from the row found, so it can only be this one.
  const client: SystemClient = type === 'SONARR'
    ? await getSonarrClient(id)
    : type === 'RADARR'
      ? await getRadarrClient(id)
      : type === 'LIDARR'
        ? await getLidarrClient(id)
        : new ProwlarrClient(connection.url, connection.apiKey, getConnectionHeaders(connection));
  return { ok: true, target: { type, instanceId: id, client, apiKey: connection.apiKey } };
}

const VERSION = /^[\w.+-]{1,64}$/;

function versionString(value: unknown): string {
  return typeof value === 'string' && VERSION.test(value) ? value : '';
}

/** The version and branch, and the newer version the app offers, if any. */
export async function readSystemStatus(client: SystemClient): Promise<ArrSystemStatus> {
  const [status, updates] = await Promise.allSettled([client.getSystemStatus(), client.getUpdates()]);
  if (status.status === 'rejected') throw status.reason;
  const raw = (status.value ?? {}) as { version?: unknown; branch?: unknown };
  const version = versionString(raw.version);
  const list = updates.status === 'fulfilled' && Array.isArray(updates.value) ? updates.value : null;
  // The app marks its newest release `latest`; it is an update unless it is
  // the one installed (Docker images report the same list).
  const latest = list?.find((u): u is { version?: unknown; installed?: unknown } =>
    !!u && typeof u === 'object' && (u as { latest?: unknown }).latest === true);
  const latestVersion = latest ? versionString(latest.version) : '';
  return {
    version,
    branch: versionString(raw.branch),
    updateVersion: latestVersion && latest?.installed !== true && latestVersion !== version ? latestVersion : null,
    // An empty list (a branch with no releases) says nothing either way.
    updateChecked: list !== null && list.length > 0,
  };
}

/** "00:00:15.6448806" or "1.02:03:04" (days.hours:minutes:seconds) in seconds. */
export function parseDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  return Number(days ?? 0) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds);
}

/** An ISO time, or null for none: the apps write year 1 for a task never run. */
function timeOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).getUTCFullYear() >= 2000 ? new Date(time).toISOString() : null;
}

function shortText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function toSystemTasks(raw: unknown, runnable: ReadonlySet<string>): ArrSystemTask[] {
  return (Array.isArray(raw) ? raw : []).flatMap((task: Record<string, unknown> | null) => {
    const taskName = shortText(task?.taskName, 100);
    if (!/^\w+$/.test(taskName)) return [];
    const interval = Number(task?.interval);
    return [{
      taskName,
      name: shortText(task?.name, 100) || taskName,
      intervalMinutes: Number.isFinite(interval) && interval > 0 ? interval : 0,
      lastExecution: timeOrNull(task?.lastExecution),
      nextExecution: timeOrNull(task?.nextExecution),
      lastDurationSeconds: parseDuration(task?.lastDuration),
      canRun: runnable.has(taskName),
    }];
  });
}

const MESSAGE_MAX = 2_000;
const EXCEPTION_MAX = 4_000;
const LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

/**
 * Log text as shown to an admin. The apps log the URLs they call (an indexer's
 * with its key or passkey, a download client's with its password), magnets,
 * and sometimes a key on its own. URLs are cut to their origin and the usual
 * credential redaction runs (as for Prowlarr's text). Then, for shapes those
 * miss in free text: a path after any `://` (a URL glued to the word before
 * it), a percent-encoded URL's path, `user:pass@host` without a scheme,
 * `password: x` / `"apiKey":"x"`, the instance's own key, and any bare 32-hex
 * word, the shape of every *arr API key. Redacted whole, then cut short, so a
 * cut can't leave half a secret behind.
 */
export function redactLogText(text: unknown, apiKey: string, max: number): string {
  let value = typeof text === 'string' ? text : '';
  if (apiKey.length >= 16) value = value.split(apiKey).join('[REDACTED]');
  value = redactProwlarrText(value)
    .replace(/:\/\/([^\s/"'<>]+)\/[^\s"'<>]*/g, '://$1')
    .replace(/(%3A%2F%2F[^\s%/"'<>]+)%2F[^\s&"'<>]*/gi, '$1')
    // Bounded, so a long run of word characters can't make it retry quadratically.
    // CSS punctuation is left out, or an HTML error page's `font-display:swap}@font-face` would match.
    .replace(/([^\s:@/"'<>;{}()]{1,64}):[^\s:@/"'<>;{}()]{1,128}@(?=[\w.[-])/g, '$1:[REDACTED]@')
    .replace(/(\b(?:password|passwd|passkey|token|api[_-]?key|secret)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1[REDACTED]')
    .replace(/\b[0-9a-f]{32}\b/gi, '[REDACTED]');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function toLogPage(raw: unknown, page: number, apiKey: string): ArrLogPage {
  const body = (raw ?? {}) as { records?: unknown; totalRecords?: unknown };
  const records = Array.isArray(body.records) ? body.records : [];
  const total = Number(body.totalRecords);
  const entries = records.slice(0, ARR_LOG_PAGE_SIZE).flatMap((record: Record<string, unknown> | null): ArrLogEntry[] => {
    const id = Number(record?.id);
    const time = timeOrNull(record?.time);
    if (!Number.isInteger(id) || !time) return [];
    const level = shortText(record?.level, 10).toLowerCase();
    return [{
      id,
      time,
      level: LEVELS.has(level) ? level : 'warn',
      logger: redactLogText(record?.logger, apiKey, 100),
      message: redactLogText(record?.message, apiKey, MESSAGE_MAX),
      exception: redactLogText(record?.exception, apiKey, EXCEPTION_MAX),
    }];
  });
  return {
    page,
    pageSize: ARR_LOG_PAGE_SIZE,
    totalRecords: Number.isInteger(total) && total >= 0 ? total : entries.length,
    entries,
  };
}

/** A command as the sheet follows it: its id, name and state, nothing of its body. */
export function toCommandResult(raw: CommandResult | null | undefined): CommandResult {
  return {
    id: Number(raw?.id) || 0,
    name: shortText(raw?.name, 100),
    status: shortText(raw?.status, 20),
  };
}
