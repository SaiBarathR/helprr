// "Title Added" and "Title Deleted" (AR-17): Sonarr and Radarr keep no history
// row for a series or movie being added or deleted (deleting one deletes its
// history too), so they come from the library list the cache warm already
// reads each cycle (a Redis hit while the two-minute cache is warm). Each
// instance's titles are kept in Redis and compared with the next list; the
// names are kept too, since a deleted title is no longer in the list.
import { getRedisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { getMediaHrefFromIds } from '@/lib/media-href';
import { PollNotificationCollector, type NotificationEventInput, type PollNotificationContext } from '@/lib/notification-grouping';
import { errorMessage, instanceTitle, notifyAndLog, wantedNotices } from './shared';

export type LibraryItem = { id: number; title?: string; year?: number; instanceId: string };

interface Instance {
  connection: { id: string; label: string; updatedAt: Date };
}

export interface KnownLibrary {
  /** The connection's updatedAt: another URL or key may be another library. */
  version: number;
  /** [id, name] of each title. */
  titles: Array<[number, string]>;
}

// Rewritten on every change; one left alone this long (an instance removed,
// or a library nobody changes) is read again as a first list.
const KNOWN_TTL_SECONDS = 30 * 24 * 60 * 60;

function knownKey(service: string, instanceId: string): string {
  return `helprr:library-ids:${service}:${instanceId}`;
}

function parseKnown(raw: string | null): KnownLibrary | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<KnownLibrary>;
    if (typeof value.version !== 'number' || !Array.isArray(value.titles)) return null;
    return {
      version: value.version,
      titles: value.titles.filter((t): t is [number, string] => Array.isArray(t) && typeof t[0] === 'number' && typeof t[1] === 'string'),
    };
  } catch {
    return null;
  }
}

// Sonarr already ends a title with its year when another series has the same name.
function itemName(item: LibraryItem): string {
  const title = item.title || `#${item.id}`;
  return item.year && !title.endsWith(`(${item.year})`) ? `${title} (${item.year})` : title;
}

/**
 * The titles added and deleted since the last list (each [id, name]), or null
 * when there is nothing to compare with: no list yet, or one from another
 * version of the connection.
 */
export function diffLibrary(known: KnownLibrary | null, version: number, titles: Array<[number, string]>): { added: Array<[number, string]>; deleted: Array<[number, string]> } | null {
  if (!known || known.version !== version) return null;
  const now = new Set(titles.map(([id]) => id));
  const before = new Set(known.titles.map(([id]) => id));
  return {
    added: titles.filter(([id]) => !before.has(id)),
    deleted: known.titles.filter(([id]) => !now.has(id)),
  };
}

/**
 * Compare each instance that answered this read with its last list, and send
 * what changed. The first list of an instance (or of a changed connection) only
 * records it. The new list is saved before anything is sent, so Redis refusing
 * the write sends nothing rather than the same change every cycle.
 */
export async function notifyLibraryChanges(
  service: 'sonarr' | 'radarr',
  instances: Instance[],
  result: { items: LibraryItem[]; failedInstanceIds: string[] },
  groupingEnabled: () => Promise<boolean>,
): Promise<void> {
  const answered = instances.filter(({ connection }) => !result.failedInstanceIds.includes(connection.id));
  if (answered.length === 0) return;
  const n = instances.length;
  const noun = service === 'sonarr' ? 'Series' : 'Movie';
  // A deleted title has no page left, so it (and a group of them) opens the library.
  const libraryHref = service === 'sonarr' ? '/series' : '/movies';
  const notices: Array<{ event: NotificationEventInput; context: PollNotificationContext }> = [];
  try {
    const redis = await getRedisClient();
    for (const { connection } of answered) {
      const titles = result.items
        .filter((item) => item.instanceId === connection.id && typeof item.id === 'number')
        .map((item): [number, string] => [item.id, itemName(item)]);
      const version = connection.updatedAt.getTime();
      const key = knownKey(service, connection.id);
      const diff = diffLibrary(parseKnown(await redis.get(key)), version, titles);
      if (diff && diff.added.length === 0 && diff.deleted.length === 0) continue;
      await redis.set(key, JSON.stringify({ version, titles } satisfies KnownLibrary), { EX: KNOWN_TTL_SECONDS });
      if (!diff) continue;

      const base = { source: service, instanceId: connection.id, instanceLabel: connection.label };
      for (const [id, name] of diff.added) {
        const metadata = { ...base, id, ...(service === 'sonarr' ? { seriesId: id } : { movieId: id }) };
        const redirect = getMediaHrefFromIds(metadata) ?? libraryHref;
        notices.push({
          event: {
            eventType: 'titleAdded',
            title: instanceTitle(`${noun} Added`, connection.label, n),
            body: name,
            metadata: { ...metadata, redirect },
            url: redirect,
          },
          context: { service, instanceId: connection.id, reason: 'library-title-added', itemId: id },
        });
      }
      for (const [id, name] of diff.deleted) {
        notices.push({
          event: {
            eventType: 'titleDeleted',
            title: instanceTitle(`${noun} Deleted`, connection.label, n),
            body: name,
            // No series or movie id: it would link to a page that is gone.
            metadata: { ...base, id, redirect: libraryHref },
            url: libraryHref,
          },
          context: { service, instanceId: connection.id, reason: 'library-title-deleted', itemId: id },
        });
      }
    }
  } catch (error) {
    // Redis is the cache's own store: when it fails, the warm fails too.
    noteJobFailure(error);
    logger.warn('Library change check failed', { service, error: errorMessage(error) }, { scope: 'polling' });
  }
  if (notices.length === 0) return;
  // Each instance's list is saved above whether or not anyone takes these, so
  // turning them on later does not announce every change made before.
  const collector = new PollNotificationCollector();
  for (const notice of await wantedNotices(notices)) collector.add(notice.event, notice.context);
  await collector.flush({ enabled: await groupingEnabled(), notify: notifyAndLog });
}
