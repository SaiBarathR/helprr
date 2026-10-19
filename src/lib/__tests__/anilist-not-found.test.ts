import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AxiosError, AxiosHeaders } from 'axios';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, post: mocks.post, isAxiosError: actual.isAxiosError } };
});
vi.mock('@/lib/cache/anilist-api-cache', () => ({
  getAnilistJsonWithCache: (options: { fetcher: () => Promise<unknown> }) => options.fetcher(),
}));
vi.mock('@/lib/cache/state', () => ({ getAnilistTtlSettings: async () => ({}) }));
vi.mock('@/lib/auth', () => ({
  requireUserAnyCapability: async () => ({ ok: true, user: { id: 'u1', role: 'admin' }, session: {} }),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/service-helpers', () => ({ loadTaggedLibrary: async () => ({ movies: [], series: [] }) }));

import { GET as getCharacter } from '@/app/api/anime/character/[id]/route';
import { GET as getAnime } from '@/app/api/anime/[id]/route';

// AniList answers an id it does not know with HTTP 404 and a GraphQL "Not Found." error.
const notFound = () => new AxiosError('Request failed with status code 404', 'ERR_BAD_REQUEST', undefined, undefined, {
  status: 404,
  statusText: 'Not Found',
  headers: { 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '29' },
  config: { headers: new AxiosHeaders() },
  data: { errors: [{ message: 'Not Found.', status: 404 }], data: { Character: null } },
});

const call = (handler: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>, path: string) =>
  handler(new NextRequest(`http://localhost${path}`), { params: Promise.resolve({ id: '999999999' }) });

beforeEach(() => {
  mocks.post.mockReset();
});

describe('AniList detail routes for an id AniList does not know', () => {
  it('answer 404, not 500', async () => {
    mocks.post.mockRejectedValue(notFound());

    const character = await call(getCharacter as never, '/api/anime/character/999999999');
    const anime = await call(getAnime as never, '/api/anime/999999999');

    expect(character.status).toBe(404);
    expect(await character.json()).toEqual({ error: 'Not found on AniList' });
    expect(anime.status).toBe(404);
  });

  it('still answer 500 when AniList itself fails', async () => {
    mocks.post.mockRejectedValue(new Error('socket hang up'));

    expect((await call(getCharacter as never, '/api/anime/character/1')).status).toBe(500);
  });
});

describe('AniList rate headers', () => {
  it('does not read a response without a remaining count as exhausted', async () => {
    const { noteAniListRateHeaders, rateLimitWait } = await import('@/lib/anilist-client');
    noteAniListRateHeaders({});

    await expect(rateLimitWait()).resolves.toBeUndefined();
  });
});
