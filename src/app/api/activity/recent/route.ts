import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { parseInt32 } from '@/lib/pagination';

const RECENT_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
  // Partition the private cache by session cookie so a capability-gated response can't be
  // replayed from the browser cache to a different (or logged-out) user within the TTL.
  'Vary': 'Cookie',
} as const;

interface RecentItem {
  id: string;
  title: string;
  subtitle: string;
  type: 'movie' | 'episode' | 'album';
  date: string;
  poster: string | null;
  href: string;
  instanceId?: string;
  instanceLabel?: string;
}

async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('activity.view');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    // Covers the tallest dashboard Recently Added widget (100 grid rows asks for
    // about 220); there are never more than 50 per instance anyway.
    const limit = parseInt32(searchParams.get('limit'), { min: 1, max: 250 }) ?? 10;

    const items: RecentItem[] = [];

    const [sonarrClients, radarrClients, lidarrClients] = await Promise.all([
      getSonarrClients().catch(() => []),
      getRadarrClients().catch(() => []),
      // Albums only for viewers who may see the music library.
      can(auth.user, 'music.view') ? getLidarrClients().catch(() => []) : Promise.resolve([]),
    ]);

    await Promise.all([
      ...sonarrClients.map(async ({ connection, client }) => {
        try {
          const history = await client.getHistory(1, 50, 'date', 'descending');
          const records = history.records.filter(
            (r) => r.eventType === 'downloadFolderImported' || r.eventType === 'episodeFileImported'
          );
          for (const record of records) {
            const series = record.series;
            const episode = record.episode;
            const poster = series?.images?.find((i) => i.coverType === 'poster');
            items.push({
              id: `sonarr-${connection.id}-${record.id}`,
              title: series?.title ?? record.sourceTitle,
              subtitle: episode
                ? `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')} - ${episode.title}`
                : record.sourceTitle,
              type: 'episode',
              date: record.date,
              poster: poster?.remoteUrl ?? poster?.url ?? null,
              href: record.seriesId ? `/series/${record.seriesId}?instance=${connection.id}` : '/activity',
              instanceId: connection.id,
              instanceLabel: connection.label,
            });
          }
        } catch {
          // Skip unreachable instance.
        }
      }),
      ...radarrClients.map(async ({ connection, client }) => {
        try {
          const history = await client.getHistory(1, 50, 'date', 'descending');
          const records = history.records.filter(
            (r) => r.eventType === 'downloadFolderImported' || r.eventType === 'movieFileImported'
          );
          for (const record of records) {
            const movie = record.movie;
            const poster = movie?.images?.find((i) => i.coverType === 'poster');
            items.push({
              id: `radarr-${connection.id}-${record.id}`,
              title: movie?.title ?? record.sourceTitle,
              subtitle: movie?.year ? String(movie.year) : '',
              type: 'movie',
              date: record.date,
              poster: poster?.remoteUrl ?? poster?.url ?? null,
              href: record.movieId ? `/movies/${record.movieId}?instance=${connection.id}` : '/activity',
              instanceId: connection.id,
              instanceLabel: connection.label,
            });
          }
        } catch {
          // Skip unreachable instance.
        }
      }),
      ...lidarrClients.map(async ({ connection, client }) => {
        try {
          // Lidarr writes one trackFileImported row per track (plus one downloadImported row per
          // album), so 50 unfiltered rows cover only a few albums. A second page of downloadImported
          // rows (eventType 8) reaches further back; the unfiltered page keeps disk-scan imports,
          // which write only track rows. Keep the newest row per album across both.
          const [recent, downloads] = await Promise.all([
            client.getHistory(1, 50, 'date', 'descending'),
            client.getHistory(1, 50, 'date', 'descending', { eventType: 8 }).catch(() => null),
          ]);
          const records = [...recent.records, ...(downloads?.records ?? [])]
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          const seenAlbums = new Set<number>();
          for (const record of records) {
            if (record.eventType !== 'downloadImported' && record.eventType !== 'trackFileImported') continue;
            if (record.albumId) {
              if (seenAlbums.has(record.albumId)) continue;
              seenAlbums.add(record.albumId);
            }
            const album = record.album;
            const cover =
              album?.images?.find((i) => i.coverType === 'cover')
              ?? record.artist?.images?.find((i) => i.coverType === 'poster');
            items.push({
              id: record.albumId ? `lidarr-${connection.id}-album-${record.albumId}` : `lidarr-${connection.id}-${record.id}`,
              title: record.artist?.artistName ?? album?.title ?? record.sourceTitle,
              subtitle: album?.title ?? record.sourceTitle,
              type: 'album',
              date: record.date,
              poster: cover?.remoteUrl ?? cover?.url ?? null,
              href: record.albumId ? `/music/album/${record.albumId}?instance=${connection.id}` : '/activity',
              instanceId: connection.id,
              instanceLabel: connection.label,
            });
          }
        } catch {
          // Skip unreachable instance.
        }
      }),
    ]);

    // Sort by date descending, deduplicate by unique item id, take limit
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const seen = new Set<string>();
    const deduplicated = items.filter((item) => {
      const key = item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return NextResponse.json(deduplicated.slice(0, limit), { headers: RECENT_CACHE_HEADERS });
  } catch (error) {
    console.error('Failed to fetch recent imports:', error);
    return NextResponse.json({ error: 'Failed to fetch recent imports' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/activity/recent');
