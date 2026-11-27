// The admin-only routes under /api/admin/arr-system: one Sonarr, Radarr,
// Lidarr or Prowlarr instance's version, scheduled tasks, recent warnings and
// backups, and restarting or shutting it down. Every answer is rebuilt from a
// few fields, and every text the app wrote is redacted, so nothing else it
// returns (paths of its own config, keys) reaches the browser.
import { NextResponse, type NextRequest } from 'next/server';
import { isAxiosError } from 'axios';
import { prisma } from '@/lib/db';
import { getLidarrClient, getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { ProwlarrClient } from '@/lib/prowlarr-client';
import { redactProwlarrText } from '@/lib/prowlarr-redact';
import { logger } from '@/lib/logger';
import { recordSecurityEvent, serviceTargetLabel, type SecurityAuditActor } from '@/lib/security-audit';
import type { ArrSystemAdminApi } from '@/lib/arr-system-admin-api';
import {
  ARR_LOG_PAGE_SIZE,
  type ArrBackup,
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
  systemAdmin: ArrSystemAdminApi;
}

export interface SystemTarget {
  type: SystemServiceType;
  instanceId: string;
  client: SystemClient;
  /** Only to blank it out of log text; never sent anywhere. */
  apiKey: string;
  /** The connection's label, for the security audit. */
  label: string;
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
  return { ok: true, target: { type, instanceId: id, client, apiKey: connection.apiKey, label: connection.label } };
}

const VERSION = /^[\w.+-]{1,64}$/;

function versionString(value: unknown): string {
  return typeof value === 'string' && VERSION.test(value) ? value : '';
}

/** The version and branch, and the newer version the app offers, if any. */
// How long the card waits for the update list: the app asks its own update
// server for it, which can hang up to the client's 30 s where that is blocked.
const UPDATE_LIST_WAIT_MS = 5_000;

export async function readSystemStatus(client: SystemClient): Promise<ArrSystemStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const updatesSoon = Promise.race([
    client.getUpdates(),
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), UPDATE_LIST_WAIT_MS); }),
  ]).finally(() => clearTimeout(timer));
  // Not in time: the version shows now, with the update left unchecked.
  const [status, updates] = await Promise.allSettled([client.getSystemStatus(), updatesSoon]);
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

const BACKUP_TYPES = new Set<ArrBackup['type']>(['scheduled', 'manual', 'update']);
const BACKUP_NAME = /^[\w.-]{1,200}\.zip$/;

/** A backup id from the URL: the app's ids are positive 31-bit hashes. */
export function parseBackupId(value: string): number | null {
  if (!/^\d{1,10}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 && id <= 0x7fffffff ? id : null;
}

/**
 * The app's backup list, each rebuilt from its id, name, type, size and time,
 * newest first. A row whose name or type isn't the shape the apps write is
 * left out, so its path can't be built from it either.
 */
export function toBackups(raw: unknown): ArrBackup[] {
  return (Array.isArray(raw) ? raw : []).flatMap((backup: Record<string, unknown> | null): ArrBackup[] => {
    const id = Number(backup?.id);
    const name = typeof backup?.name === 'string' ? backup.name : '';
    const type = backup?.type as ArrBackup['type'];
    const size = Number(backup?.size);
    const time = typeof backup?.time === 'string' ? Date.parse(backup.time) : NaN;
    if (!Number.isInteger(id) || !BACKUP_NAME.test(name) || !BACKUP_TYPES.has(type) || !Number.isFinite(time)) return [];
    return [{ id, name, type, size: Number.isSafeInteger(size) && size >= 0 ? size : 0, time: new Date(time).toISOString() }];
  }).sort((a, b) => b.time.localeCompare(a.time));
}

/**
 * The listed backup with this id, and where the app serves its file. The path
 * is built from the checked type and name (the app's own is
 * `/backup/<type>/<name>`), never taken from the browser.
 */
export async function findBackup(client: SystemClient, id: number): Promise<{ backup: ArrBackup; path: string } | null> {
  const backup = toBackups(await client.systemAdmin.getBackups()).find((b) => b.id === id);
  return backup ? { backup, path: `/backup/${backup.type}/${backup.name}` } : null;
}

/** The database file each app's backup holds, and restores from. */
const BACKUP_DATABASE: Record<SystemServiceType, string> = {
  SONARR: 'sonarr.db',
  RADARR: 'radarr.db',
  LIDARR: 'lidarr.db',
  PROWLARR: 'prowlarr.db',
};

/**
 * The names of the files in a zip, from its central directory, or null when
 * it isn't a zip Helprr can read (no end record, a ZIP64 or split archive, or
 * entries that run past the end).
 */
export function zipEntryNames(bytes: Uint8Array): string[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50) return null;
  // The end record is the last 22 bytes, plus a comment of up to 64 KiB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff) return null;
  const names: string[] = [];
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) return null;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (offset + 46 + nameLength > end) return null;
    names.push(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/**
 * Why an uploaded file can't be restored into this app, or null when it can.
 * The app restores the database and config.xml from a zip and fails on
 * anything else, but moves config.xml into place first: another app's backup
 * (radarr.db in Sonarr) would swap in that app's config. So the zip must hold
 * this app's database at its top level, as the app's own backups do.
 */
export function uploadedBackupProblem(type: SystemServiceType, bytes: Uint8Array): string | null {
  const names = zipEntryNames(bytes);
  if (!names) return 'That file is not a backup zip.';
  const database = BACKUP_DATABASE[type];
  if (!names.some((name) => name.toLowerCase() === database)) {
    return `That zip has no ${database}, so it is not a backup of this app.`;
  }
  return null;
}

/**
 * A restart, shutdown or backup step taken on the app, in the security audit
 * as a change to its connection (as adding an app in Prowlarr is). `step`
 * names it, never a value or a secret.
 */
export async function recordSystemAction(
  request: NextRequest,
  actor: SecurityAuditActor,
  target: Pick<SystemTarget, 'type' | 'instanceId' | 'label'>,
  step: string,
): Promise<void> {
  await recordSecurityEvent(request, {
    actor,
    action: 'SERVICE_UPDATED',
    targetType: 'service',
    targetId: target.instanceId,
    targetLabel: serviceTargetLabel(target.type, target.label),
    fields: [step],
  });
}

/**
 * After a restore: record it, then restart the app so it takes effect, as the
 * app's own System → Backup does. False when the restart wasn't accepted (the
 * restore stands; the app takes it on its next start).
 */
export async function restartAfterRestore(
  request: NextRequest,
  actor: SecurityAuditActor,
  target: Pick<SystemTarget, 'type' | 'instanceId' | 'label' | 'client'>,
  step: string,
): Promise<boolean> {
  const meta = { userId: actor.id, username: actor.username, instanceId: target.instanceId };
  const scope = { scope: target.type.toLowerCase() };
  logger.info('App backup restored', { ...meta, step }, scope);
  await recordSystemAction(request, actor, target, step);
  try {
    await target.client.systemAdmin.power('restart');
    return true;
  } catch (error) {
    logger.warn('Restart after a restore was not accepted', {
      ...meta,
      error: error instanceof Error ? error.message : String(error),
    }, scope);
    return false;
  }
}

/**
 * The app took the request but no answer came back (a timeout, or a proxy in
 * front of it cutting the connection). A restore or delete may then have
 * happened anyway: the app moves a restored config.xml into place at once.
 */
export function upstreamNoAnswer(error: unknown): boolean {
  return isAxiosError(error) && !error.response && !NEVER_SENT.has(error.code ?? '');
}

/** Connection errors that mean the request never reached the app. */
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ERR_INVALID_URL']);

/** A step that may have gone through: recorded, and said so to the admin. */
export async function maybeDoneResponse(
  request: NextRequest,
  actor: SecurityAuditActor,
  target: Pick<SystemTarget, 'type' | 'instanceId' | 'label'>,
  step: string,
  message: string,
): Promise<NextResponse> {
  logger.warn('App did not answer a backup step', {
    userId: actor.id,
    username: actor.username,
    instanceId: target.instanceId,
    step,
  }, { scope: target.type.toLowerCase() });
  await recordSystemAction(request, actor, target, `${step} (no answer from the app)`);
  return NextResponse.json({ error: message }, { status: 504 });
}
