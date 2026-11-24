// "App Update Available" (AR-17): a new Sonarr, Radarr, Lidarr or Prowlarr
// version, to admins, once per version and instance. Read from each app's own
// GET /update (v3 for Sonarr/Radarr, v1 for Lidarr/Prowlarr) once a day: the
// app lists its recent releases newest first and marks the newest "latest"
// and the running one "installed" (read from all four, 2026-11-25).
import { getLidarrClients, getProwlarrClient, getRadarrClients, getSonarrClients } from '@/lib/service-helpers';
import { getDefaultConnection } from '@/lib/arr-instances';
import { ConfigurationError } from '@/lib/config-error';
import { getRedisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { noteJobFailure, noteJobSkipped } from '@/lib/polling-job-report';
import type { ArrUpdate } from '@/types';
import { errorMessage, instanceTitle, notifyAndLog, wantedNotices } from './shared';

export const ARR_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** After an app could not be read, try again this much later (the others are not announced twice). */
export const ARR_UPDATE_RETRY_MS = 60 * 60 * 1000;

type App = 'sonarr' | 'radarr' | 'lidarr' | 'prowlarr';
const APP_NAMES: Record<App, string> = { sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr', prowlarr: 'Prowlarr' };

interface Target {
  app: App;
  instanceId: string;
  label: string;
  /** Instances of this app, for the title's instance prefix. */
  count: number;
  getUpdates: () => Promise<ArrUpdate[]>;
}

/**
 * The release to announce, with the running version: the newest one when it
 * is not the one running. A running release listed above it (a newer branch)
 * is not behind.
 */
export function availableUpdate(updates: ArrUpdate[]): { version: string; installedVersion: string | null } | null {
  if (!Array.isArray(updates)) return null;
  const latest = updates.findIndex((u) => u?.latest);
  if (latest === -1 || updates[latest].installed || typeof updates[latest].version !== 'string') return null;
  const installed = updates.findIndex((u) => u?.installed);
  if (installed !== -1 && installed < latest) return null;
  return { version: updates[latest].version, installedVersion: installed === -1 ? null : updates[installed].version };
}

// The version last announced per instance. The history row's dedupe key alone
// is not enough: clearing notifications or retention removes it.
function notifiedKey(instanceId: string): string {
  return `helprr:arr-update:notified:${instanceId}`;
}

async function readNotified(instanceId: string): Promise<string | null> {
  try {
    return await (await getRedisClient()).get(notifiedKey(instanceId));
  } catch {
    return null; // The dedupe key still stops a repeat while its row exists.
  }
}

async function rememberNotified(instanceId: string, version: string): Promise<void> {
  try {
    await (await getRedisClient()).set(notifiedKey(instanceId), version);
  } catch {
    // As above.
  }
}

async function targets(): Promise<Target[]> {
  const list: Target[] = [];
  const families = [
    ['sonarr', getSonarrClients],
    ['radarr', getRadarrClients],
    ['lidarr', getLidarrClients],
  ] as const;
  for (const [app, getClients] of families) {
    const instances = await getClients();
    for (const { connection, client } of instances) {
      list.push({ app, instanceId: connection.id, label: connection.label, count: instances.length, getUpdates: () => client.getUpdates() });
    }
  }
  try {
    const client = await getProwlarrClient();
    const connection = await getDefaultConnection('PROWLARR');
    if (connection) list.push({ app: 'prowlarr', instanceId: connection.id, label: connection.label, count: 1, getUpdates: () => client.getUpdates() });
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
  }
  return list;
}

/**
 * Returns false when the check should run again after ARR_UPDATE_RETRY_MS: an
 * app could not be read, or nobody takes the event yet (the apps are not asked
 * then, and an admin who turns it on hears within the hour, not the next day).
 */
export async function checkArrUpdates(): Promise<boolean> {
  const probe = { event: { eventType: 'arrUpdateAvailable', metadata: {} } };
  if ((await wantedNotices([probe])).length === 0) {
    noteJobSkipped();
    return false;
  }
  const results = await Promise.allSettled((await targets()).map(async (target) => {
    const update = availableUpdate(await target.getUpdates());
    if (!update || await readNotified(target.instanceId) === update.version) return;
    const name = APP_NAMES[target.app];
    const sent = await notifyAndLog({
      eventType: 'arrUpdateAvailable',
      title: instanceTitle(`${name} update available`, target.label, target.count),
      body: update.installedVersion
        ? `${name} ${update.version} is out (this one runs ${update.installedVersion}).`
        : `${name} ${update.version} is out.`,
      url: '/settings/status',
      // Also once per version when two checks race.
      dedupeKey: `arrUpdateAvailable:${target.instanceId}:${update.version}`,
      metadata: { source: target.app, instanceId: target.instanceId, instanceLabel: target.label, id: update.version, redirect: '/settings/status' },
    }, { service: target.app, instanceId: target.instanceId, reason: 'arr-update-available' });
    if (sent !== null) await rememberNotified(target.instanceId, update.version);
  }));
  let ok = true;
  for (const result of results) {
    if (result.status === 'rejected') {
      ok = false;
      noteJobFailure(result.reason);
      logger.warn('App update check failed', { error: errorMessage(result.reason) }, { scope: 'polling' });
    }
  }
  return ok;
}
