import { describe, expect, it } from 'vitest';
import type { Capability } from '@/lib/capabilities';
import { SEARCH_PROVIDER_BY_ID, canUseSearchProvider } from '@/lib/search/provider-defs';

const holding = (...caps: Capability[]) => (cap: Capability) => caps.includes(cap);
const tmdb = SEARCH_PROVIDER_BY_ID.tmdb;

describe('canUseSearchProvider', () => {
  it('lets anyone who may browse Discover search TMDB', () => {
    expect(canUseSearchProvider(tmdb, holding('discover.view'), false)).toBe(true);
  });

  it('lets a requester without Discover search TMDB when they can open its title pages', () => {
    expect(canUseSearchProvider(tmdb, holding('requests.create', 'movies.view'), true)).toBe(true);
  });

  it('keeps TMDB closed to a requester who could not open the results, or has no Seerr to request through', () => {
    expect(canUseSearchProvider(tmdb, holding('requests.create'), true)).toBe(false);
    expect(canUseSearchProvider(tmdb, holding('requests.create', 'movies.view'), false)).toBe(false);
  });

  it('keeps TMDB closed to a library viewer who cannot request', () => {
    expect(canUseSearchProvider(tmdb, holding('movies.view', 'series.view'), true)).toBe(false);
  });

  it('opens no other provider to requesters', () => {
    expect(canUseSearchProvider(SEARCH_PROVIDER_BY_ID.anilist, holding('requests.create', 'movies.view'), true)).toBe(false);
  });
});
