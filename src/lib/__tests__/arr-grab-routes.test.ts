import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';

// The Sonarr and Radarr interactive-search grab routes: who may grab, which
// bodies reach the *arr (rebuilt from validated fields only), and how its
// refusals come back. Real permission resolution.

const mocks = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  sonarr: { grabRelease: vi.fn() },
  radarr: { grabRelease: vi.fn() },
  getSonarrClient: vi.fn(),
  getRadarrClient: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: async (cap: Capability) => {
    if (!mocks.user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    return can(mocks.user as never, cap)
      ? { ok: true, user: mocks.user, session: {} }
      : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  },
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/arr-instances', () => ({
  resolveConnection: async (type: string, instanceId?: string | null) => ({ id: instanceId || `default-${type}` }),
}));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: mocks.getSonarrClient,
  getRadarrClient: mocks.getRadarrClient,
}));
// The browser sends its search's token for the guid; the route grabs with what it stands for.
const tokens = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('@/lib/release-tokens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/release-tokens')>()),
  resolveReleaseToken: tokens.resolve,
}));
const REAL = { guid: 'https://tracker.example/details/42', indexerId: 77 };
/** What reaches the *arr: the body as sent, with the token's own guid and indexer. */
const resolved = (sent: Record<string, unknown>) => ({ ...sent, ...REAL });

import { POST as sonarrGrab } from '@/app/api/sonarr/release/route';
import { arrReleaseScope } from '@/lib/release-tokens';
import { POST as radarrGrab } from '@/app/api/radarr/release/route';

const ADMIN = { id: 'admin', role: 'admin', template: 'admin', permissions: {} };
const MANAGER = { id: 'm', role: 'member', template: 'member', permissions: { 'activity.manage': true } };
const VIEWER = { id: 'v', role: 'member', template: 'member', permissions: { 'activity.manage': false } };

const QUALITY = { quality: { id: 7, name: 'WEBDL-1080p', source: 'web', resolution: 1080 }, revision: { version: 2, real: 0, isRepack: false } };
const LANGUAGES = [{ id: 1, name: 'English' }, { id: 4, name: 'Chinese' }];

function post(route: typeof sonarrGrab, service: string, body: unknown, instanceId = 'inst-1') {
  return route(new NextRequest(`http://localhost/api/${service}/release?instanceId=${instanceId}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}
const grabSonarr = (body: unknown, instanceId?: string) => post(sonarrGrab, 'sonarr', body, instanceId);
const grabRadarr = (body: unknown, instanceId?: string) => post(radarrGrab, 'radarr', body, instanceId);

function arrError(status: number, message: string) {
  const headers = new AxiosHeaders();
  return new AxiosError('Request failed', String(status), { headers }, null, {
    status, statusText: '', headers, config: { headers },
    data: { message, description: `NzbDrone.Core.Exceptions.NzbDroneClientException: ${message}\n   at http://10.0.0.5:8989/secret` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = MANAGER;
  mocks.sonarr.grabRelease.mockResolvedValue(undefined);
  mocks.radarr.grabRelease.mockResolvedValue(undefined);
  mocks.getSonarrClient.mockResolvedValue(mocks.sonarr);
  mocks.getRadarrClient.mockResolvedValue(mocks.radarr);
  tokens.resolve.mockImplementation(async (_scope: string, _user: string, token: string) => (token === 'stale' ? null : REAL));
});

describe('who may grab', () => {
  it.each([['sonarr', grabSonarr], ['radarr', grabRadarr]] as const)('%s: signed-out is 401 and a member without activity.manage 403, before any upstream call', async (_s, grab) => {
    mocks.user = null;
    expect((await grab({ guid: 'g', indexerId: 1 })).status).toBe(401);
    mocks.user = VIEWER;
    expect((await grab({ guid: 'g', indexerId: 1 })).status).toBe(403);
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
    expect(mocks.getRadarrClient).not.toHaveBeenCalled();
    expect(tokens.resolve).not.toHaveBeenCalled();
  });

  it('lets an admin and a manager grab, on the instance in the query', async () => {
    mocks.user = ADMIN;
    expect((await grabSonarr({ guid: 'g', indexerId: 1 }, 'son-2')).status).toBe(200);
    expect(mocks.getSonarrClient).toHaveBeenCalledWith('son-2');
    mocks.user = MANAGER;
    expect((await grabRadarr({ guid: 'g', indexerId: 1 }, 'rad-3')).status).toBe(200);
    expect(mocks.getRadarrClient).toHaveBeenCalledWith('rad-3');
  });
});

describe('Sonarr grab bodies', () => {
  it.each([
    ['plain', { guid: 'g', indexerId: 5 }, { guid: 'g', indexerId: 5 }],
    ['a magnet guid with many trackers', { guid: `magnet:?xt=urn:btih:${'A'.repeat(40)}${'&tr=udp%3a%2f%2ftracker.example%3a6969%2fannounce'.repeat(60)}`, indexerId: 5 },
      { guid: `magnet:?xt=urn:btih:${'A'.repeat(40)}${'&tr=udp%3a%2f%2ftracker.example%3a6969%2fannounce'.repeat(60)}`, indexerId: 5 }],
    ['plain, another client', { guid: 'g', indexerId: 5, downloadClientId: 2 }, { guid: 'g', indexerId: 5, downloadClientId: 2 }],
    ['the default client (null)', { guid: 'g', indexerId: 5, downloadClientId: null }, { guid: 'g', indexerId: 5 }],
    ['the searched episode', { guid: 'g', indexerId: 5, episodeId: 2477 }, { guid: 'g', indexerId: 5, episodeId: 2477 }],
    ['the searched season, Specials too', { guid: 'g', indexerId: 5, seriesId: 22, seasonNumber: 0 }, { guid: 'g', indexerId: 5, seriesId: 22, seasonNumber: 0 }],
    ['a manual grab', {
      guid: 'g', indexerId: 5, downloadClientId: 1, shouldOverride: true, seriesId: 22, episodeIds: [2477, 2478],
      quality: { ...QUALITY, extra: 'dropped' }, languages: [{ ...LANGUAGES[0], extra: 1 }, LANGUAGES[1]],
    }, {
      guid: 'g', indexerId: 5, downloadClientId: 1, shouldOverride: true, seriesId: 22, episodeIds: [2477, 2478],
      quality: QUALITY, languages: LANGUAGES,
    }],
  ])('forwards %s exactly', async (_label, body, sent) => {
    const res = await grabSonarr({ ...body, unknownField: 'x' });
    expect(res.status).toBe(200);
    expect(mocks.sonarr.grabRelease).toHaveBeenCalledWith(resolved(sent));
  });

  it.each([
    ['not JSON', '{', 'Invalid JSON body'],
    ['an array', [], 'Invalid request body'],
    ['no guid', { indexerId: 1 }, 'guid and indexerId are required'],
    ['no indexer', { guid: 'g' }, 'guid and indexerId are required'],
    ['a zero indexer', { guid: 'g', indexerId: 0 }, 'Invalid release'],
    ['a giant guid', { guid: 'x'.repeat(16_385), indexerId: 1 }, 'Invalid release'],
    ['a text client id', { guid: 'g', indexerId: 1, downloadClientId: '1' }, 'Invalid download client'],
    ['a fractional episode', { guid: 'g', indexerId: 1, episodeId: 1.5 }, 'Invalid episode'],
    ['episode and season at once', { guid: 'g', indexerId: 1, episodeId: 3, seriesId: 2, seasonNumber: 1 }, 'Invalid episode'],
    ['a season without its series', { guid: 'g', indexerId: 1, seasonNumber: 1 }, 'Invalid season'],
    ['a series without its season', { guid: 'g', indexerId: 1, seriesId: 2 }, 'Invalid season'],
    ['a negative season', { guid: 'g', indexerId: 1, seriesId: 2, seasonNumber: -1 }, 'Invalid season'],
    ['manual-grab fields without shouldOverride', { guid: 'g', indexerId: 1, episodeIds: [1] }, 'Invalid grab'],
    ['shouldOverride false', { guid: 'g', indexerId: 1, shouldOverride: false }, 'Invalid manual grab'],
    ['a manual grab with the searched episode too', { guid: 'g', indexerId: 1, shouldOverride: true, episodeId: 3 }, 'Invalid manual grab'],
    ['a manual grab with no series', { guid: 'g', indexerId: 1, shouldOverride: true, episodeIds: [1], quality: QUALITY, languages: LANGUAGES }, 'Choose a series'],
    ['a manual grab with no episodes', { guid: 'g', indexerId: 1, shouldOverride: true, seriesId: 2, episodeIds: [], quality: QUALITY, languages: LANGUAGES }, 'Choose at least one episode'],
    ['a manual grab with a repeated episode', { guid: 'g', indexerId: 1, shouldOverride: true, seriesId: 2, episodeIds: [1, 1], quality: QUALITY, languages: LANGUAGES }, 'Choose at least one episode'],
    ['a manual grab with 501 episodes', { guid: 'g', indexerId: 1, shouldOverride: true, seriesId: 2, episodeIds: Array.from({ length: 501 }, (_, i) => i + 1), quality: QUALITY, languages: LANGUAGES }, 'Choose at least one episode'],
    ['a manual grab with no quality', { guid: 'g', indexerId: 1, shouldOverride: true, seriesId: 2, episodeIds: [1], languages: LANGUAGES }, 'Choose a quality'],
    ['a manual grab with a quality missing its revision', { guid: 'g', indexerId: 1, shouldOverride: true, seriesId: 2, episodeIds: [1], quality: { quality: QUALITY.quality }, languages: LANGUAGES }, 'Choose a quality'],
    ['a manual grab with no languages', { guid: 'g', indexerId: 1, shouldOverride: true, seriesId: 2, episodeIds: [1], quality: QUALITY, languages: [] }, 'Choose at least one language'],
    ['a manual grab with a nameless language', { guid: 'g', indexerId: 1, shouldOverride: true, seriesId: 2, episodeIds: [1], quality: QUALITY, languages: [{ id: 1 }] }, 'Choose at least one language'],
  ])('refuses %s with 400, without calling Sonarr', async (_label, body, error) => {
    const res = await grabSonarr(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(mocks.sonarr.grabRelease).not.toHaveBeenCalled();
  });
});

describe('Radarr grab bodies', () => {
  it.each([
    ['plain', { guid: 'g', indexerId: 5 }, { guid: 'g', indexerId: 5 }],
    ['the searched movie', { guid: 'g', indexerId: 5, movieId: 11 }, { guid: 'g', indexerId: 5, movieId: 11 }],
    ['a manual grab', { guid: 'g', indexerId: 5, shouldOverride: true, movieId: 12, quality: QUALITY, languages: LANGUAGES, seriesId: 3 },
      { guid: 'g', indexerId: 5, shouldOverride: true, movieId: 12, quality: QUALITY, languages: LANGUAGES }],
  ])('forwards %s exactly', async (_label, body, sent) => {
    expect((await grabRadarr(body)).status).toBe(200);
    expect(mocks.radarr.grabRelease).toHaveBeenCalledWith(resolved(sent));
  });

  it.each([
    ['a text movie id', { guid: 'g', indexerId: 1, movieId: '11' }, 'Invalid movie'],
    ['a quality without shouldOverride', { guid: 'g', indexerId: 1, quality: QUALITY }, 'Invalid grab'],
    ['a manual grab with no movie', { guid: 'g', indexerId: 1, shouldOverride: true, quality: QUALITY, languages: LANGUAGES }, 'Choose a movie'],
    ['a manual grab with no languages', { guid: 'g', indexerId: 1, shouldOverride: true, movieId: 2, quality: QUALITY }, 'Choose at least one language'],
  ])('refuses %s with 400, without calling Radarr', async (_label, body, error) => {
    const res = await grabRadarr(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(mocks.radarr.grabRelease).not.toHaveBeenCalled();
  });
});

describe('release tokens', () => {
  it.each([['sonarr', grabSonarr, 'son-2'], ['radarr', grabRadarr, 'rad-3']] as const)(
    '%s resolves the token in its own instance and user scope', async (service, grab, instanceId) => {
      await grab({ guid: 'tok', indexerId: 1 }, instanceId);
      expect(tokens.resolve).toHaveBeenCalledWith(arrReleaseScope(service, instanceId), MANAGER.id, 'tok');
    },
  );

  it.each([['sonarr', grabSonarr], ['radarr', grabRadarr]] as const)(
    '%s: a token it never issued (or one past 30 minutes) is an expired result, with no call upstream', async (_s, grab) => {
      const res = await grab({ guid: 'stale', indexerId: 1 });
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: 'This result has expired. Search again.', code: 'expired' });
      expect(mocks.getSonarrClient).not.toHaveBeenCalled();
      expect(mocks.getRadarrClient).not.toHaveBeenCalled();
    },
  );
});

describe('refusals from the *arr', () => {
  it.each([
    ['sonarr', 404, "Couldn't find requested release in cache, try searching again", 410, 'expired', 'This result has expired. Search again.'],
    ['sonarr', 404, 'Unable to find matching series and episodes, will need to be manually provided', 422, 'unmatched', "Sonarr couldn't tell which series and episodes this release is for. Choose them in Manual grab."],
    ['sonarr', 404, 'Unable to parse episodes in the release, will need to be manually provided', 422, 'unmatched', "Sonarr couldn't tell which episodes this release is for. Choose them in Manual grab."],
    ['radarr', 404, 'Unable to find matching movie, will need to be manually provided', 422, 'unmatched', "Radarr couldn't tell which movie this release is for. Choose it in Manual grab."],
    ['radarr', 409, 'Getting release from indexer failed', 502, 'indexer', "The release couldn't be fetched, or the download client refused it. Try another one."],
    ['sonarr', 500, 'Download client failed to add torrent by url', 502, 'client', "The download client didn't take this release. Check it, or try another release."],
  ] as const)('%s %i "%s" → %i %s', async (service, upstream, message, status, code, error) => {
    const client = service === 'sonarr' ? mocks.sonarr : mocks.radarr;
    client.grabRelease.mockRejectedValue(arrError(upstream, message));
    const res = await (service === 'sonarr' ? grabSonarr : grabRadarr)({ guid: 'g', indexerId: 1 });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, code });
  });

  it('keeps the generic answer for anything else, never passing on upstream text', async () => {
    mocks.sonarr.grabRelease.mockRejectedValue(arrError(500, 'Object reference not set at http://10.0.0.5:8989'));
    let res = await grabSonarr({ guid: 'g', indexerId: 1 });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to grab release' });

    mocks.sonarr.grabRelease.mockRejectedValue(arrError(404, 'Series 99 does not exist'));
    res = await grabSonarr({ guid: 'g', indexerId: 1 });
    expect(await res.json()).toEqual({ error: 'Not found' });

    mocks.radarr.grabRelease.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:7878'));
    res = await grabRadarr({ guid: 'g', indexerId: 1 });
    expect(await res.json()).toEqual({ error: 'Failed to grab release' });
  });
});
