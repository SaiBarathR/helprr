// The admin push (and channel message) when a new Helprr release is out: once
// per version, through the same six-hour cached check the Status page uses.
import { checkForUpdates } from '@/lib/update-check';
import { noteJobSkipped } from '@/lib/polling-job-report';
import { getRedisClient } from '@/lib/redis';
import { notifyAndLog } from './shared';

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** After a failed check (GitHub unreachable), try again this much later. */
export const UPDATE_CHECK_RETRY_MS = 60 * 60 * 1000;
// The last version announced. The notification history's dedupe row alone is
// not enough: clearing notifications or retention removes it, and the same
// version would be announced again.
const NOTIFIED_VERSION_KEY = 'helprr:update-check:notified-version';

async function notifiedVersion(): Promise<string | null> {
  try {
    return await (await getRedisClient()).get(NOTIFIED_VERSION_KEY);
  } catch {
    return null; // The dedupe key below still stops a repeat while its row exists.
  }
}

async function rememberNotified(version: string): Promise<void> {
  try {
    await (await getRedisClient()).set(NOTIFIED_VERSION_KEY, version);
  } catch {
    // As above.
  }
}

/** Returns false when the check could not reach GitHub, so the caller retries after UPDATE_CHECK_RETRY_MS. */
export async function checkUpdateAvailable(currentVersion = process.env.NEXT_PUBLIC_APP_VERSION || 'unknown'): Promise<boolean> {
  const result = await checkForUpdates(currentVersion);
  if (result.status === 'unavailable') {
    noteJobSkipped();
    return false;
  }
  if (result.status !== 'update_available' || !result.latestVersion || await notifiedVersion() === result.latestVersion) {
    noteJobSkipped();
    return true;
  }
  // The dedupe key also makes this once per version when two checks race.
  const sent = await notifyAndLog({
    eventType: 'updateAvailable',
    title: 'Helprr update available',
    body: `Helprr ${result.latestVersion} is out (this server runs ${result.currentVersion}).`,
    url: '/settings/status',
    dedupeKey: `updateAvailable:${result.latestVersion}`,
    metadata: { source: 'helprr', id: result.latestVersion },
  }, { service: 'helprr', reason: 'update-available' });
  if (sent !== null) await rememberNotified(result.latestVersion);
  return true;
}
