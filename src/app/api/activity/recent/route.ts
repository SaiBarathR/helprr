import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

interface RecentItem {
  id: string;
  title: string;
  subtitle: string;
  type: 'movie' | 'episode';
  date: string;
  poster: string | null;
  href: string;
  instanceId?: string;
  instanceLabel?: string;
}

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') ?? '10', 10);

    const items: RecentItem[] = [];

    const [sonarrClients, radarrClients] = await Promise.all([
      getSonarrClients().catch(() => []),
      getRadarrClients().catch(() => []),
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

    return NextResponse.json(deduplicated.slice(0, limit));
  } catch (error) {
    console.error('Failed to fetch recent imports:', error);
    return NextResponse.json({ error: 'Failed to fetch recent imports' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/activity/recent');
