import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Capability } from '@/lib/capabilities';
import { ANIME_DETAIL_PAGE_CAPABILITIES, TMDB_TITLE_PAGE_CAPABILITIES } from '@/lib/capabilities';

// Real permission resolution (can(), member template, deltas) behind the two
// route helpers; the helpers themselves are covered in auth-session-role.test.ts.
// Every upstream entry point records the call and throws, so a request either
// stops at the gate or is seen reaching TMDB/AniList.
const mocks = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; template: string; permissions: Record<string, boolean> },
  upstream: [] as string[],
}));

vi.mock('@/lib/auth', async () => {
  const { can } = await import('@/lib/permissions');
  const { NextResponse: Res } = await import('next/server');
  const gate = (caps: readonly Capability[]) => {
    const user = mocks.user;
    if (!user) return { ok: false as const, response: Res.json({ error: 'Unauthorized' }, { status: 401 }) };
    if (!caps.some((cap) => can(user as never, cap))) {
      return { ok: false as const, response: Res.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { ok: true as const, user, session: {} };
  };
  return {
    requireUserCapability: vi.fn(async (cap: Capability) => gate([cap])),
    requireUserAnyCapability: vi.fn(async (caps: readonly Capability[]) => gate(caps)),
  };
});
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));

function reached(name: string) {
  return vi.fn(async () => {
    mocks.upstream.push(name);
    throw new Error('upstream reached');
  });
}

vi.mock('@/lib/service-helpers', () => ({
  getTMDBClient: reached('tmdb'),
  loadTaggedLibrary: reached('library'),
}));
vi.mock('@/lib/anilist-client', () => ({
  AniListRateLimitError: class AniListRateLimitError extends Error {},
  getAnimeDetail: reached('anilist'),
  getAnimeNextAiringEpisode: reached('anilist'),
  getCharacterDetail: reached('anilist'),
  getAnimeHome: reached('anilist'),
  getMangaDetail: reached('anilist'),
  getAnimeAiringSchedule: reached('anilist'),
  getStaffCharacterMediaPage: reached('anilist'),
  getStaffDetail: reached('anilist'),
  getStaffMediaPage: reached('anilist'),
  getStudioDetail: reached('anilist'),
}));
vi.mock('@/lib/anilist-series-mapping', () => ({
  loadLibraryLinksForAnilistIds: reached('mapping'),
}));
vi.mock('@/lib/app-settings', () => ({
  getOrCreateAppSettings: reached('settings'),
}));

import { requireUserAnyCapability, requireUserCapability } from '@/lib/auth';
import { GET as animeDetail } from '@/app/api/anime/[id]/route';
import { GET as animeCharacter } from '@/app/api/anime/character/[id]/route';
import { GET as animeHome } from '@/app/api/anime/home/route';
import { GET as animeManga } from '@/app/api/anime/manga/[id]/route';
import { GET as animeSchedule } from '@/app/api/anime/schedule/route';
import { GET as animeStaff } from '@/app/api/anime/staff/[id]/route';
import { GET as animeStudio } from '@/app/api/anime/studio/[id]/route';
import { GET as discoverCollection } from '@/app/api/discover/collection/[id]/route';
import { GET as discoverFilters } from '@/app/api/discover/filters/route';
import { GET as discoverItem } from '@/app/api/discover/item/route';
import { GET as discoverMovie } from '@/app/api/discover/movie/[id]/route';
import { GET as discoverPerson } from '@/app/api/discover/person/route';
import { GET as discoverTv } from '@/app/api/discover/tv/[id]/route';
import { GET as discoverSeason } from '@/app/api/discover/tv/[id]/season/[seasonNumber]/route';

interface Case {
  name: string;
  anyOf: readonly Capability[];
  invoke: () => Promise<Response>;
}

const req = (path: string) => new NextRequest(`http://localhost${path}`);
const withParams = <T extends object>(params: T) => ({ params: Promise.resolve(params) });

const cases: Case[] = [
  { name: 'anime detail', anyOf: ANIME_DETAIL_PAGE_CAPABILITIES,
    invoke: () => animeDetail(req('/api/anime/21'), withParams({ id: '21' })) },
  { name: 'anime character', anyOf: ANIME_DETAIL_PAGE_CAPABILITIES,
    invoke: () => animeCharacter(req('/api/anime/character/40'), withParams({ id: '40' })) },
  { name: 'anime manga', anyOf: ANIME_DETAIL_PAGE_CAPABILITIES,
    invoke: () => animeManga(req('/api/anime/manga/30'), withParams({ id: '30' })) },
  { name: 'anime staff', anyOf: ANIME_DETAIL_PAGE_CAPABILITIES,
    invoke: () => animeStaff(req('/api/anime/staff/95'), withParams({ id: '95' })) },
  { name: 'anime studio', anyOf: ANIME_DETAIL_PAGE_CAPABILITIES,
    invoke: () => animeStudio(req('/api/anime/studio/11'), withParams({ id: '11' })) },
  { name: 'anime home', anyOf: ['anime.view'],
    invoke: () => animeHome(req('/api/anime/home?perPage=10')) },
  { name: 'anime schedule', anyOf: ['anime.view'],
    invoke: () => animeSchedule(req('/api/anime/schedule?weekStart=1760000000&weekEnd=1760600000')) },
  { name: 'discover collection', anyOf: TMDB_TITLE_PAGE_CAPABILITIES,
    invoke: () => discoverCollection(req('/api/discover/collection/10'), withParams({ id: '10' })) },
  { name: 'discover movie', anyOf: TMDB_TITLE_PAGE_CAPABILITIES,
    invoke: () => discoverMovie(req('/api/discover/movie/550'), withParams({ id: '550' })) },
  { name: 'discover person', anyOf: TMDB_TITLE_PAGE_CAPABILITIES,
    invoke: () => discoverPerson(req('/api/discover/person?id=287')) },
  { name: 'discover tv', anyOf: TMDB_TITLE_PAGE_CAPABILITIES,
    invoke: () => discoverTv(req('/api/discover/tv/1399'), withParams({ id: '1399' })) },
  { name: 'discover tv season', anyOf: TMDB_TITLE_PAGE_CAPABILITIES,
    invoke: () => discoverSeason(req('/api/discover/tv/1399/season/1'), withParams({ id: '1399', seasonNumber: '1' })) },
  { name: 'discover filters', anyOf: ['discover.view', 'settings.appearance'],
    invoke: () => discoverFilters(req('/api/discover/filters')) },
  { name: 'discover item', anyOf: ['discover.view'],
    invoke: () => discoverItem(req('/api/discover/item?mediaType=movie&id=550')) },
];

/** A member holding exactly `granted` among the capabilities a case cares about. */
function memberWith(c: Case, granted: readonly Capability[]) {
  const permissions: Record<string, boolean> = {};
  for (const cap of c.anyOf) permissions[cap] = granted.includes(cap);
  return { id: 'member-1', role: 'member', template: 'member', permissions };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
  mocks.upstream = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('Anime and Discover read routes', () => {
  it.each(cases)('$name: unauthenticated is 401 before any upstream call', async (c) => {
    expect((await c.invoke()).status).toBe(401);
    expect(mocks.upstream).toEqual([]);
  });

  it.each(cases)('$name: a member holding none of its capabilities gets 403 and no upstream call', async (c) => {
    mocks.user = memberWith(c, []);
    expect((await c.invoke()).status).toBe(403);
    expect(mocks.upstream).toEqual([]);
  });

  it.each(cases.flatMap((c) => c.anyOf.map((cap) => ({ ...c, cap }))))(
    '$name: $cap alone reaches the upstream client',
    async (c) => {
      mocks.user = memberWith(c, [c.cap]);
      const res = await c.invoke();
      expect([401, 403]).not.toContain(res.status);
      expect(mocks.upstream.length).toBeGreaterThan(0);
    },
  );

  it.each(cases)('$name: admin passes the gate', async (c) => {
    mocks.user = { id: 'admin-1', role: 'admin', template: 'admin', permissions: {} };
    const res = await c.invoke();
    expect([401, 403]).not.toContain(res.status);
  });

  it('asks each route for exactly its declared policy', async () => {
    mocks.user = { id: 'admin-1', role: 'admin', template: 'admin', permissions: {} };
    for (const c of cases) {
      vi.mocked(requireUserCapability).mockClear();
      vi.mocked(requireUserAnyCapability).mockClear();
      await c.invoke();
      if (c.anyOf.length === 1) {
        expect(requireUserCapability, c.name).toHaveBeenCalledWith(c.anyOf[0]);
      } else {
        expect(requireUserAnyCapability, c.name).toHaveBeenCalledWith(c.anyOf);
      }
    }
  });

  it('still serves the AniList entry a Series detail page links to without anime.view', async () => {
    // A member with series.view but no anime.view reads the AniList entry a
    // mapped anime series links to (Series detail → Open in Anime).
    const c = cases[0];
    mocks.user = { id: 'member-1', role: 'member', template: 'member', permissions: { 'anime.view': false } };
    expect([401, 403]).not.toContain((await c.invoke()).status);
  });
});
