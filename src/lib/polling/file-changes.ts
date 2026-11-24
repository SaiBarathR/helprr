// Sonarr/Radarr history rows for a file deleted or renamed, as "File Deleted"
// and "Files Renamed" notifications (AR-17). Row shapes read from real Sonarr
// 4.0 and Radarr 7.0 history (2026-11-25): a deletion is
// "episodeFileDeleted"/"movieFileDeleted" with data.reason, a rename
// "episodeFileRenamed"/"movieFileRenamed" with data.relativePath (the new name,
// relative to the series or movie folder). sourceTitle is the file's full path
// on the arr's disk, so it is never put in a notification.
import type { HistoryItem } from '@/types';
import { getMediaHrefFromIds } from '@/lib/media-href';
import type { NotificationEventInput, PollNotificationContext } from '@/lib/notification-grouping';
import { positiveId } from './upgrade-imports';
import { instanceTitle } from './shared';

// DeleteMediaFileReason in Sonarr and Radarr. "Upgrade" is left out: the arr
// writes it for the old file just before importing its better copy, which is
// already sent as "Upgraded".
const DELETE_REASONS: Record<string, string> = {
  MissingFromDisk: 'missing from disk',
  Manual: 'deleted',
  NoLinkedEpisodes: 'no longer linked to an episode',
  ManualOverride: 'replaced by a manual import',
};

type Notice = { event: NotificationEventInput; context: PollNotificationContext };

interface Instance {
  service: 'sonarr' | 'radarr';
  instanceId: string;
  instanceLabel: string;
  instanceCount: number;
}

function reasonText(item: HistoryItem): string | null {
  const reason = item.data?.reason;
  if (reason === 'Upgrade') return null;
  return (reason && DELETE_REASONS[reason]) || 'deleted';
}

function episodeCode(item: HistoryItem): string {
  const season = item.episode?.seasonNumber;
  const episode = item.episode?.episodeNumber;
  if (typeof season !== 'number' || typeof episode !== 'number') return '';
  return ` S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

function movieName(item: HistoryItem): string | undefined {
  const title = item.movie?.title;
  if (!title) return undefined;
  return item.movie?.year ? `${title} (${item.movie.year})` : title;
}

// The new file name only: the folders above it name the arr's disk layout.
function fileName(item: HistoryItem): string | null {
  const path = item.data?.relativePath || item.data?.path;
  if (!path) return null;
  return path.split(/[\\/]/).pop() || null;
}

/**
 * The file notifications for one poll's new history rows. A deletion is one
 * notification per file, as the arrs' own "On File Delete". A rename is one
 * per series or movie, as their "On Rename": renaming a series writes a row
 * for every episode file.
 */
export function fileChangeNotices(newHistory: HistoryItem[], instance: Instance): Notice[] {
  const { service, instanceId, instanceLabel, instanceCount: n } = instance;
  const deletedType = service === 'sonarr' ? 'episodeFileDeleted' : 'movieFileDeleted';
  const renamedType = service === 'sonarr' ? 'episodeFileRenamed' : 'movieFileRenamed';
  const notices: Notice[] = [];
  const renames = new Map<number, HistoryItem[]>();

  for (const item of newHistory) {
    if (item.eventType === deletedType) {
      const reason = reasonText(item);
      if (!reason) continue;
      const seriesId = positiveId(item.seriesId);
      const movieId = positiveId(item.movieId);
      const name = service === 'sonarr'
        ? item.series?.title && `${item.series.title}${episodeCode(item)}`
        : movieName(item);
      if (!name || (service === 'sonarr' ? !seriesId : !movieId)) continue;
      const quality = item.quality?.quality?.name;
      const metadata = {
        source: service,
        instanceId,
        instanceLabel,
        id: item.id,
        ...(service === 'sonarr'
          ? { seriesId, seasonNumber: item.episode?.seasonNumber, episodeId: positiveId(item.episodeId ?? item.episode?.id) }
          : { movieId }),
      };
      const redirect = getMediaHrefFromIds(metadata) ?? '/activity/history';
      notices.push({
        event: {
          eventType: 'fileDeleted',
          title: instanceTitle(service === 'sonarr' ? 'Episode File Deleted' : 'Movie File Deleted', instanceLabel, n),
          body: `${name}${quality ? ` (${quality})` : ''}: ${reason}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        },
        context: { service, instanceId, reason: 'history-file-deleted', historyId: item.id },
      });
    } else if (item.eventType === renamedType) {
      const targetId = positiveId(service === 'sonarr' ? item.seriesId : item.movieId);
      if (!targetId) continue;
      const rows = renames.get(targetId) ?? [];
      rows.push(item);
      renames.set(targetId, rows);
    }
  }

  for (const [targetId, rows] of renames) {
    const first = rows[0];
    const name = service === 'sonarr' ? first.series?.title : movieName(first);
    if (!name) continue;
    const newName = rows.length === 1 ? fileName(first) : null;
    const metadata = {
      source: service,
      instanceId,
      instanceLabel,
      id: first.id,
      ...(service === 'sonarr' ? { seriesId: targetId } : { movieId: targetId }),
    };
    const redirect = getMediaHrefFromIds(metadata) ?? '/activity/history';
    const what = service === 'sonarr' ? `${name}${rows.length === 1 ? episodeCode(first) : ''}` : name;
    notices.push({
      event: {
        eventType: 'fileRenamed',
        title: instanceTitle(rows.length === 1 ? 'File Renamed' : 'Files Renamed', instanceLabel, n),
        body: rows.length > 1
          ? `${what}: ${rows.length} files renamed`
          : newName ? `${what}: now ${newName}` : `${what}: file renamed`,
        metadata: { ...metadata, redirect },
        url: redirect,
      },
      context: { service, instanceId, reason: 'history-file-renamed', historyIds: rows.map((row) => row.id) },
    });
  }
  return notices;
}
