import { getSonarrClients, getRadarrClients } from '@/lib/service-helpers';
import { matchLocalQuery } from '@/lib/search/providers/local-module';
import type { ProviderHandler } from '@/lib/search/providers/types';
import type { SearchProviderResult } from '@/lib/search/types';

interface ActivityRow {
  id: string;
  title: string;
  subtitle: string;
  poster: string | null;
  route: string;
  date: string;
}

export const searchActivity: ProviderHandler = async ({ query, limit }) => {
  const rows: ActivityRow[] = [];

  const [sonarrClients, radarrClients] = await Promise.all([
    getSonarrClients().catch(() => []),
    getRadarrClients().catch(() => []),
  ]);

  await Promise.all([
    ...sonarrClients.map(async ({ connection, client }) => {
      try {
        const history = await client.getHistory(1, 100, 'date', 'descending');
        for (const record of history.records) {
          const series = record.series;
          const episode = record.episode;
          const poster = series?.images?.find((i) => i.coverType === 'poster');
          rows.push({
            id: `activity:sonarr:${connection.id}:${record.id}`,
            title: series?.title ?? record.sourceTitle,
            subtitle: episode
              ? `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')} · ${record.eventType}`
              : record.sourceTitle,
            poster: poster?.remoteUrl ?? poster?.url ?? null,
            route: record.seriesId ? `/series/${record.seriesId}?instance=${connection.id}` : '/activity',
            date: record.date,
          });
        }
      } catch {
        // skip unreachable instance
      }
    }),
    ...radarrClients.map(async ({ connection, client }) => {
      try {
        const history = await client.getHistory(1, 100, 'date', 'descending');
        for (const record of history.records) {
          const movie = record.movie;
          const poster = movie?.images?.find((i) => i.coverType === 'poster');
          rows.push({
            id: `activity:radarr:${connection.id}:${record.id}`,
            title: movie?.title ?? record.sourceTitle,
            subtitle: record.eventType,
            poster: poster?.remoteUrl ?? poster?.url ?? null,
            route: record.movieId ? `/movies/${record.movieId}?instance=${connection.id}` : '/activity',
            date: record.date,
          });
        }
      } catch {
        // skip unreachable instance
      }
    }),
  ]);

  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const results: SearchProviderResult[] = rows
    .filter((row) => matchLocalQuery(query, row.title, row.subtitle))
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      year: null,
      poster: row.poster,
      route: row.route,
      provider: 'activity' as const,
    }));

  return { results };
};
