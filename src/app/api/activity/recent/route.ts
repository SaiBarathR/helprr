import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';

interface RecentItem {
  id: string;
  title: string;
  subtitle: string;
  type: 'movie' | 'episode';
  date: string;
  poster: string | null;
  href: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') ?? '10', 10);

    const items: RecentItem[] = [];

    const [sonarrResult, radarrResult] = await Promise.allSettled([
      (async () => {
        try {
          const sonarr = await getSonarrClient();
          const history = await sonarr.getHistory(1, 50, 'date', 'descending');
          return history.records.filter(
            (r) => r.eventType === 'downloadFolderImported' || r.eventType === 'episodeFileImported'
          );
        } catch {
          return [];
        }
      })(),
      (async () => {
        try {
          const radarr = await getRadarrClient();
          const history = await radarr.getHistory(1, 50, 'date', 'descending');
          return history.records.filter(
            (r) => r.eventType === 'downloadFolderImported' || r.eventType === 'movieFileImported'
          );
        } catch {
          return [];
        }
      })(),
    ]);

    const sonarrRecords = sonarrResult.status === 'fulfilled' ? sonarrResult.value : [];
    const radarrRecords = radarrResult.status === 'fulfilled' ? radarrResult.value : [];

    for (const record of sonarrRecords) {
      const series = record.series;
      const episode = record.episode;
      const poster = series?.images?.find((i) => i.coverType === 'poster');
      items.push({
        id: `sonarr-${record.id}`,
        title: series?.title ?? record.sourceTitle,
        subtitle: episode
          ? `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')} - ${episode.title}`
          : record.sourceTitle,
        type: 'episode',
        date: record.date,
        poster: poster?.remoteUrl ?? poster?.url ?? null,
        href: record.seriesId ? `/series/${record.seriesId}` : '/activity',
      });
    }

    for (const record of radarrRecords) {
      const movie = record.movie;
      const poster = movie?.images?.find((i) => i.coverType === 'poster');
      items.push({
        id: `radarr-${record.id}`,
        title: movie?.title ?? record.sourceTitle,
        subtitle: movie?.year ? String(movie.year) : '',
        type: 'movie',
        date: record.date,
        poster: poster?.remoteUrl ?? poster?.url ?? null,
        href: record.movieId ? `/movies/${record.movieId}` : '/activity',
      });
    }

    // Sort by date descending, deduplicate by title, take limit
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const seen = new Set<string>();
    const deduplicated = items.filter((item) => {
      const key = `${item.type}-${item.title}`;
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
