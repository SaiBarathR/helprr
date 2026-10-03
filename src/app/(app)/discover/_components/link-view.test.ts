import { describe, expect, it } from 'vitest';
import { DEFAULT_DISCOVER_FILTERS } from '@/lib/store';
import type { DiscoverFiltersResponse } from '@/types';
import { discoverFilterChips, discoverLinkView, type DiscoverView } from './link-view';

const link = (query: string) => discoverLinkView(new URLSearchParams(query));

describe('discoverLinkView', () => {
  it('is null for a plain visit or a search-only link', () => {
    expect(link('')).toBeNull();
    expect(link('q=dune')).toBeNull();
    expect(link('contentType=movie')).toBeNull();
  });

  it('starts a filter link from the defaults, not the saved filters', () => {
    expect(link('companies=41077&companyName=A24&contentType=movie')).toEqual({
      contentType: 'movie',
      sort: 'popular',
      sortDirection: 'desc',
      filters: { ...DEFAULT_DISCOVER_FILTERS, companies: [41077] },
      section: null,
      manualBrowseMode: true,
      person: null,
      names: { 'company:41077': 'A24' },
    });
  });

  it('maps a section link to its sort and content type', () => {
    expect(link('section=upcoming_movies')).toMatchObject({
      section: 'upcoming_movies',
      sort: 'upcoming',
      sortDirection: 'asc',
      contentType: 'movie',
      filters: DEFAULT_DISCOVER_FILTERS,
    });
  });

  it.each([
    ['trending_movies', 'trending', 'movie'],
    ['trending_tv', 'trending', 'show'],
    ['popular_all', 'popular', 'all'],
    ['highly_rated', 'highlyRated', 'all'],
    ['most_loved', 'mostLoved', 'all'],
  ])('maps the %s section the API serves onto its sort chip and content type', (section, sort, contentType) => {
    expect(link(`section=${section}`)).toMatchObject({ section, sort, contentType });
  });

  it('carries a custom carousel\'s full filter set', () => {
    const view = link('contentType=show&sortBy=highlyRated&sortOrder=asc&genres=18,80&yearFrom=2010&releaseState=bogus');
    expect(view).toMatchObject({ contentType: 'show', sort: 'highlyRated', sortDirection: 'asc' });
    expect(view?.filters).toMatchObject({ genres: [18, 80], yearFrom: '2010', releaseState: '' });
  });

  it('opens a cast link as popular movies with that person', () => {
    expect(link('person=287&personName=Brad%20Pitt')).toMatchObject({
      person: { id: 287, name: 'Brad Pitt' },
      contentType: 'movie',
      sort: 'popular',
    });
    expect(link('person=287')).toBeNull();
  });
});

describe('discoverFilterChips', () => {
  const meta = {
    genres: [{ id: 18, name: 'Drama', type: 'movie' }, { id: 18, name: 'Drama (TV)', type: 'tv' }],
    providers: [{ id: 8, name: 'Netflix', logoPath: null, displayPriority: 1, type: 'movie' }],
    networks: [{ id: 49, name: 'HBO', logoPath: null }],
    regions: [{ code: 'GB', name: 'United Kingdom' }],
    languages: [{ code: 'ko', name: 'Korean' }],
    releaseStates: [{ value: 'upcoming', label: 'Upcoming' }],
  } as DiscoverFiltersResponse;

  const view = (overrides: Partial<DiscoverView>): DiscoverView => ({
    contentType: 'all',
    sort: 'trending',
    sortDirection: 'desc',
    filters: { ...DEFAULT_DISCOVER_FILTERS },
    section: null,
    manualBrowseMode: false,
    person: null,
    names: {},
    ...overrides,
  });

  it('names nothing when no filter hides results', () => {
    expect(discoverFilterChips(view({ sort: 'popular', section: 'trending' }), meta)).toEqual([]);
  });

  it("doesn't offer to remove a section's own content type", () => {
    expect(discoverFilterChips(view({ contentType: 'movie', section: 'now_playing' }), meta)).toEqual([]);
  });

  it('names each filter, preferring the content type\'s genre name', () => {
    const chips = discoverFilterChips(view({
      contentType: 'show',
      filters: {
        ...DEFAULT_DISCOVER_FILTERS,
        genres: [18],
        providers: [8],
        networks: [49],
        companies: [41077],
        yearFrom: '2010',
        runtimeMax: '45',
        ratingMin: '7.5',
        voteCountMin: '500',
        language: 'ko',
        region: 'GB',
        releaseState: 'upcoming',
      },
    }), meta);
    expect(chips.map((chip) => chip.label)).toEqual([
      'Shows', 'Drama (TV)', 'Netflix', 'HBO', 'Studio', '2010+', '≤ 45 min', 'Rated 7.5+', '500+ votes',
      'Korean', 'Region: United Kingdom', 'Upcoming',
    ]);
  });

  it('uses the name a link passed for a studio', () => {
    const chips = discoverFilterChips(view({
      filters: { ...DEFAULT_DISCOVER_FILTERS, companies: [41077] },
      names: { 'company:41077': 'A24' },
    }), null);
    expect(chips.map((chip) => chip.label)).toEqual(['A24']);
  });

  it('removes only its own filter', () => {
    const filters = { ...DEFAULT_DISCOVER_FILTERS, genres: [18, 80], yearFrom: '2010', yearTo: '2020' };
    const chips = discoverFilterChips(view({ filters }), meta);
    expect(chips.find((chip) => chip.id === 'genre:18')?.patch).toEqual({ filters: { ...filters, genres: [80] } });
    expect(chips.find((chip) => chip.id === 'year')).toMatchObject({
      label: '2010–2020',
      patch: { filters: { ...filters, yearFrom: '', yearTo: '' } },
    });
  });
});
