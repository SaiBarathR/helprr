import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchMoviePool: vi.fn(),
  fetchSeriesPool: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'u1', role: 'member', template: 'member', permissions: {} } })),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/service-helpers', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/random-watch-pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/random-watch-pool')>()),
  fetchMoviePool: mocks.fetchMoviePool,
  fetchSeriesPool: mocks.fetchSeriesPool,
}));

import { GET } from './route';

const movie = (id: number, genres: string[], runtime: number) => ({ id, instanceId: 'r1', title: `M${id}`, hasFile: true, images: [], genres, runtime });
const show = (id: number, genres: string[], runtime: number) => ({ id, instanceId: 's1', title: `S${id}`, images: [], genres, runtime, statistics: { episodeFileCount: 1 } });

async function roll(query: string) {
  const res = await GET(new NextRequest(`http://helprr.test/api/random-watch?${query}`));
  return (await res.json()) as { pick: { id: number } | null; poolSize: number; genres: string[] };
}

beforeEach(() => {
  mocks.fetchMoviePool.mockResolvedValue([movie(1, ['Comedy'], 85), movie(2, ['Drama'], 130), movie(3, ['Comedy', 'Drama'], 100)]);
  mocks.fetchSeriesPool.mockResolvedValue([show(4, ['Animation'], 24)]);
});

describe('GET /api/random-watch filters', () => {
  it('lists the genres of the whole pool for the type, whatever genres are chosen', async () => {
    expect((await roll('type=any&watch=all&genre=Comedy')).genres).toEqual(['Animation', 'Comedy', 'Drama']);
    expect((await roll('type=movie&watch=all')).genres).toEqual(['Comedy', 'Drama']);
  });

  it('rolls only from titles in a chosen genre and length', async () => {
    expect((await roll('type=any&watch=all&genre=Comedy')).poolSize).toBe(2);
    expect((await roll('type=any&watch=all&genre=Comedy&genre=Animation')).poolSize).toBe(3);
    const long = await roll('type=movie&watch=all&runtime=over120');
    expect(long).toMatchObject({ poolSize: 1, pick: { id: 2 } });
    // The length is for movies only: the 24-minute series stays in with any length.
    expect((await roll('type=any&watch=all&runtime=under90')).poolSize).toBe(2);
    expect((await roll('type=any&watch=all&runtime=over120')).poolSize).toBe(2);
  });

  it('ignores a length on a series-only roll and an unknown length', async () => {
    expect((await roll('type=series&watch=all&runtime=over120')).poolSize).toBe(1);
    expect((await roll('type=any&watch=all&runtime=forever')).poolSize).toBe(4);
  });
});
