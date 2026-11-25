import { getQBittorrentClient, getQBittorrentClients } from '@/lib/service-helpers';
import { matchLocalQuery } from '@/lib/search/providers/local-module';
import { torrentStateBadge } from '@/lib/qbittorrent-summary';
import type { ProviderHandler } from '@/lib/search/providers/types';
import type { SearchProviderResult } from '@/lib/search/types';

export const searchTorrents: ProviderHandler = async ({ query, limit }) => {
  const instances = await getQBittorrentClients();
  if (instances.length === 0) await getQBittorrentClient(); // throws "not configured"
  // Every qBittorrent, default first; one that doesn't answer is left out,
  // unless none answers.
  const listed = await Promise.allSettled(instances.map(async ({ connection, client }) =>
    (await client.getTorrents()).map((torrent) => ({ connection, torrent }))));
  const rejected = listed.find((result) => result.status === 'rejected');
  if (rejected && listed.every((result) => result.status === 'rejected')) throw rejected.reason;

  const matched = listed
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .filter(({ torrent: t }) => matchLocalQuery(query, t.name, t.hash, t.category, t.tags))
    .slice(0, limit);

  const many = instances.length > 1;
  const results: SearchProviderResult[] = matched.map(({ connection, torrent: t }) => ({
    // The same torrent can be in two qBittorrents.
    id: `torrent:${connection.id}:${t.hash}`,
    title: t.name,
    subtitle: [many ? connection.label : null, t.category, torrentStateBadge(t.state).label, `${Math.round(t.progress * 100)}%`].filter(Boolean).join(' · '),
    year: null,
    poster: null,
    route: `/torrents?instance=${encodeURIComponent(connection.id)}`,
    provider: 'torrents',
  }));

  return { results };
};
