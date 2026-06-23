import { getQBittorrentClient } from '@/lib/service-helpers';
import { matchLocalQuery } from '@/lib/search/providers/local-module';
import type { ProviderHandler } from '@/lib/search/providers/types';
import type { SearchProviderResult } from '@/lib/search/types';

export const searchTorrents: ProviderHandler = async ({ query, limit }) => {
  const client = await getQBittorrentClient();
  const torrents = await client.getTorrents();

  const matched = torrents
    .filter((t) => matchLocalQuery(query, t.name, t.hash, t.category, t.tags))
    .slice(0, limit);

  const results: SearchProviderResult[] = matched.map((t) => ({
    id: `torrent:${t.hash}`,
    title: t.name,
    subtitle: [t.category, t.state, `${Math.round(t.progress * 100)}%`].filter(Boolean).join(' · '),
    year: null,
    poster: null,
    route: '/torrents',
    provider: 'torrents',
  }));

  return { results };
};
