import { describe, expect, it, vi } from 'vitest';

const torrents = [
  { hash: 'a', name: 'Cosmos Laundromat', category: 'films', tags: '', state: 'stoppedDL', progress: 0 },
  { hash: 'b', name: 'Cosmos Seed', category: '', tags: '', state: 'stalledUP', progress: 1 },
];
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: vi.fn(),
  getQBittorrentClients: vi.fn(async () => [
    { connection: { id: 'q1', label: 'Home' }, client: { getTorrents: async () => torrents } },
  ]),
}));

import { searchTorrents } from './torrents';

describe('searchTorrents', () => {
  it("names a torrent's state the way the Torrents list does, not qBittorrent's raw state", async () => {
    const { results } = await searchTorrents({ query: 'cosmos', limit: 10 } as Parameters<typeof searchTorrents>[0]);
    expect(results.map((result) => result.subtitle)).toEqual(['films · Stopped · 0%', 'Seeding · 100%']);
  });
});
