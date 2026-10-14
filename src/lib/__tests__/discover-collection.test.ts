import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AxiosError, AxiosHeaders } from 'axios';

const mocks = vi.hoisted(() => ({
  requireUserAnyCapability: vi.fn(),
  getCurrentUser: vi.fn(),
  getTMDBClient: vi.fn(),
  loadTaggedLibrary: vi.fn(),
  collectionDetails: vi.fn(),
  headers: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUserAnyCapability: mocks.requireUserAnyCapability,
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/service-helpers', () => ({
  getTMDBClient: mocks.getTMDBClient,
  loadTaggedLibrary: mocks.loadTaggedLibrary,
}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import { TmdbRateLimitError } from '@/lib/tmdb-client';
import { GET } from '@/app/api/discover/collection/[id]/route';
import DiscoverCollectionPage from '@/app/(app)/discover/collection/[id]/page';

const COLLECTION = {
  id: 10,
  name: 'Saga Collection',
  overview: 'All of it',
  poster_path: null,
  backdrop_path: null,
  parts: [
    { id: 2, title: 'Second', release_date: '2002-01-01' },
    { id: 1, title: 'First', release_date: '2001-01-01' },
  ],
};

function routeCall(id: string) {
  return GET(new NextRequest(`http://localhost/api/discover/collection/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function upstream404() {
  return new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 404,
    statusText: 'Not Found',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  });
}

const fetchSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.requireUserAnyCapability.mockResolvedValue({ ok: true, user: { id: 'member' }, session: {} });
  mocks.getCurrentUser.mockResolvedValue({ id: 'member', role: 'member' });
  mocks.getTMDBClient.mockResolvedValue({ collectionDetails: mocks.collectionDetails });
  mocks.collectionDetails.mockResolvedValue(COLLECTION);
  mocks.loadTaggedLibrary.mockResolvedValue({
    movies: [{ id: 77, tmdbId: 1, title: 'First', titleSlug: 'first', year: 2001, instanceId: 'radarr-hd', instanceLabel: 'HD' }],
    series: [],
  });
  mocks.headers.mockResolvedValue(new Headers({
    host: 'helprr.local',
    'x-forwarded-host': 'attacker.example',
    'x-forwarded-proto': 'https',
    cookie: 'helprr-session=member-session',
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Discover collection page', () => {
  it('loads through the server helper, with no outbound request and no forwarded cookie', async () => {
    const element = await DiscoverCollectionPage({ params: Promise.resolve({ id: '10' }) });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.collectionDetails).toHaveBeenCalledWith(10);
    expect(JSON.stringify(element)).toContain('Saga Collection');
  });

  it('refuses a request with no signed-in user before loading anything', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    await expect(DiscoverCollectionPage({ params: Promise.resolve({ id: '10' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.collectionDetails).not.toHaveBeenCalled();
  });

  it('shows the not-found message for an upstream 404', async () => {
    mocks.collectionDetails.mockRejectedValueOnce(upstream404());
    const element = await DiscoverCollectionPage({ params: Promise.resolve({ id: '10' }) });
    expect(JSON.stringify(element)).toContain('Not found');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/discover/collection/[id]', () => {
  it('returns the collection sorted by release date and annotated with the library', async () => {
    const res = await routeCall('10');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parts.map((p: { title: string }) => p.title)).toEqual(['First', 'Second']);
    expect(body.parts[0].library).toMatchObject({ exists: true, id: 77, instanceId: 'radarr-hd' });
    expect(body.parts[1].library).toMatchObject({ exists: false });
  });

  it.each(['0', '-3', 'abc'])('rejects collection id %s with 400 before calling TMDB', async (id) => {
    const res = await routeCall(id);
    expect(res.status).toBe(400);
    expect(mocks.collectionDetails).not.toHaveBeenCalled();
  });

  it('maps an upstream 404 to 404', async () => {
    mocks.collectionDetails.mockRejectedValueOnce(upstream404());
    expect((await routeCall('10')).status).toBe(404);
  });

  it('maps a TMDB rate limit to 429 with retry details', async () => {
    mocks.collectionDetails.mockRejectedValueOnce(new TmdbRateLimitError('limited', 7, null));
    const res = await routeCall('10');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'TMDB_RATE_LIMIT', retryAfterSeconds: 7 });
  });

  it('hides other upstream failures behind a generic 500', async () => {
    mocks.collectionDetails.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.9:443'));
    const res = await routeCall('10');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to load collection' });
  });

  it.each([401, 403])('stops a %i at the gate before TMDB', async (status) => {
    mocks.requireUserAnyCapability.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status }),
    });
    expect((await routeCall('10')).status).toBe(status);
    expect(mocks.collectionDetails).not.toHaveBeenCalled();
  });
});
