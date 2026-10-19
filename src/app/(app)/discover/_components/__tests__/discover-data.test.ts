import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/query-fetch';
import { DEFAULT_DISCOVER_FILTERS, type DiscoverFiltersState } from '@/lib/store';
import {
  RateLimitError,
  buildCustomCarouselParams,
  computeCarouselItemLimit,
  countActiveAdvancedFilters,
  discoverFetch,
  formatWait,
  isDefaultFilters,
  normalizeFilterValues,
} from '../discover-data';

const filters = (extra: Partial<DiscoverFiltersState> = {}): DiscoverFiltersState => ({ ...DEFAULT_DISCOVER_FILTERS, ...extra });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('discoverFetch', () => {
  const respond = (status: number, body: string) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));

  it('returns the JSON of a good answer', async () => {
    respond(200, '{"results":[1]}');
    await expect(discoverFetch('/api/discover')).resolves.toEqual({ results: [1] });
  });

  it('raises the rate-limit banner on a 429 or a TMDB_RATE_LIMIT body, with its payload', async () => {
    respond(429, '{"retryAfterSeconds":30}');
    const error = await discoverFetch('/api/discover').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).payload).toEqual({ retryAfterSeconds: 30 });
    respond(200, '{"code":"TMDB_RATE_LIMIT"}');
    await expect(discoverFetch('/api/discover')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('throws an ApiError with the status on any other failure, even without a JSON body', async () => {
    respond(500, '<html>oops</html>');
    const error = await discoverFetch('/api/discover').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
  });
});

describe('discover filters', () => {
  it('builds a custom carousel query with only the filters it sets', () => {
    expect(Object.fromEntries(buildCustomCarouselParams({ contentType: 'movie', sortBy: 'popularity', sortOrder: 'desc' }, 24))).toEqual({
      mode: 'browse', page: '1', limit: '24', contentType: 'movie', sortBy: 'popularity', sortOrder: 'desc',
    });
    const params = buildCustomCarouselParams({
      contentType: 'show', sortBy: 'rating', sortOrder: 'asc', genres: [18, 35], yearFrom: '2000', yearTo: '2010',
      runtimeMin: '20', runtimeMax: '60', ratingMin: '7', ratingMax: '9', voteCountMin: '100', language: 'ja',
      region: 'JP', providers: [8], networks: [213, 49], companies: [], releaseState: 'released',
    }, 16);
    expect(params.get('genres')).toBe('18,35');
    expect(params.get('networks')).toBe('213,49');
    expect(params.has('companies')).toBe(false);
    expect([...params.keys()]).toEqual([
      'mode', 'page', 'limit', 'contentType', 'sortBy', 'sortOrder', 'genres', 'yearFrom', 'yearTo', 'runtimeMin', 'runtimeMax',
      'ratingMin', 'ratingMax', 'voteCountMin', 'language', 'region', 'providers', 'networks', 'releaseState',
    ]);
  });

  it('normalizes typed values before they are applied', () => {
    expect(normalizeFilterValues(filters({
      yearFrom: ' 1999.7 ', yearTo: '-5', runtimeMin: 'abc', runtimeMax: '0', ratingMin: '0', ratingMax: '7.5',
      voteCountMin: '', language: ' JA ', region: 'gbr',
    }))).toEqual(filters({
      yearFrom: '1999', yearTo: '', runtimeMin: '', runtimeMax: '', ratingMin: '0', ratingMax: '7.5',
      voteCountMin: '', language: 'ja', region: 'GB',
    }));
    expect(normalizeFilterValues(filters({ region: '' })).region).toBe('US');
  });

  it('tells default filters apart', () => {
    expect(isDefaultFilters(filters())).toBe(true);
    expect(isDefaultFilters(filters({ region: '' }))).toBe(true);
    expect(isDefaultFilters(filters({ region: 'GB' }))).toBe(false);
    expect(isDefaultFilters(filters({ providers: [8] }))).toBe(false);
    expect(isDefaultFilters(filters({ releaseState: 'released' }))).toBe(false);
    expect(isDefaultFilters(filters({ genres: [18] }))).toBe(false);
  });

  it('counts each advanced filter group once', () => {
    expect(countActiveAdvancedFilters(filters())).toBe(0);
    expect(countActiveAdvancedFilters(filters({ yearFrom: '2000', yearTo: '2010', ratingMin: '7', region: 'US' }))).toBe(2);
    expect(countActiveAdvancedFilters(filters({
      genres: [1], yearTo: '2010', runtimeMax: '60', ratingMax: '9', voteCountMin: '10', language: 'ja', region: 'JP',
      providers: [8], networks: [1], companies: [2], releaseState: 'released',
    }))).toBe(11);
  });

  it('formats the wait before TMDB can be asked again', () => {
    expect(formatWait(-3)).toBe('0s');
    expect(formatWait(42.9)).toBe('42s');
    expect(formatWait(125)).toBe('2m 5s');
  });
});

describe('carousel size', () => {
  it('loads about two and a half screens of cards, between 16 and 46', () => {
    const at = (width: number) => {
      vi.stubGlobal('window', { innerWidth: width });
      return computeCarouselItemLimit();
    };
    expect(at(390)).toBe(16); // 3 cards visible → 8, raised to 16
    expect(at(1024)).toBe(16); // 5 visible
    expect(at(1440)).toBe(18); // 7 visible
    expect(at(5000)).toBe(46); // 24 visible → 60, capped
    vi.unstubAllGlobals();
    expect(typeof window).toBe('undefined');
    expect(computeCarouselItemLimit()).toBe(24);
  });
});
