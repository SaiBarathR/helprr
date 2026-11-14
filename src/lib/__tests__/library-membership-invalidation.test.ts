import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateAfterLibraryAdd, invalidateAfterLibraryRemove, invalidateLibraryMembership } from '@/lib/query-invalidation';
import { queryKeys } from '@/lib/query-keys';
import type { DiscoverDetail, DiscoverItem, DiscoverResponse } from '@/types';

const item = (tmdbId: number, mediaType: 'movie' | 'tv', extra: Partial<DiscoverItem> = {}): DiscoverItem => ({
  id: tmdbId, tmdbId, mediaType, title: `T${tmdbId}`, overview: '', posterPath: null, backdropPath: null,
  releaseDate: null, year: 2026, rating: 7, voteCount: 1, popularity: 1, genres: [], library: { exists: false }, ...extra,
});

const detail = (tmdbId: number, service: 'radarr' | 'sonarr', extra: Partial<DiscoverDetail> = {}): DiscoverDetail => ({
  ...item(tmdbId, service === 'radarr' ? 'movie' : 'tv'),
  runtime: null, status: null, productionCompanies: [], networks: [],
  addTarget: { service, exists: false }, ...extra,
});

const sectionsKey = queryKeys.discover('sections', { perSectionLimit: 16 });
const gridKey = queryKeys.discover('grid', { query: '' });

function seed() {
  const qc = new QueryClient();
  qc.setQueryData<DiscoverResponse>(sectionsKey, {
    mode: 'sections',
    sections: [
      { key: 'trending', title: 'Trending', type: 'media', items: [item(10, 'movie'), item(10, 'tv'), item(11, 'movie')] },
      { key: 'movie_genres', title: 'Movie Genres', type: 'genre', items: [{ id: 10, name: 'Action' } as never] },
    ],
  });
  qc.setQueryData<InfiniteData<DiscoverResponse>>(gridKey, {
    pageParams: [1],
    pages: [{ mode: 'browse', items: [item(11, 'movie'), item(10, 'movie')] }],
  });
  qc.setQueryData(queryKeys.discoverDetail('movie', 10), detail(10, 'radarr'));
  qc.setQueryData(queryKeys.discoverDetail('tv', 10), detail(10, 'sonarr'));
  qc.setQueryData(queryKeys.discover('filters'), { genres: [] });
  qc.setQueryData(queryKeys.discover('layout'), { sections: [] });
  qc.setQueryData(queryKeys.discoverCredits('movie', 10), { cast: [] });
  return qc;
}

const added = { id: 501, tmdbId: 10, titleSlug: 't10', instanceId: 'radarr-b', instanceLabel: 'Radarr B' };

describe('invalidateAfterLibraryAdd', () => {
  it('shows the added film in the library on every cached Discover page at once', () => {
    const qc = seed();
    invalidateAfterLibraryAdd(qc, 'radarr', added);

    const sections = qc.getQueryData<DiscoverResponse>(sectionsKey)!.sections![0].items as DiscoverItem[];
    expect(sections[0].library).toEqual({
      exists: true, type: 'movie', id: 501, titleSlug: 't10', tmdbId: 10, instanceId: 'radarr-b',
      instances: [{ instanceId: 'radarr-b', instanceLabel: 'Radarr B', id: 501, titleSlug: 't10' }],
    });
    // Same TMDB id, other kind: a show is not the film.
    expect(sections[1].library).toEqual({ exists: false });
    expect(sections[2].library).toEqual({ exists: false });

    const grid = qc.getQueryData<InfiniteData<DiscoverResponse>>(gridKey)!.pages[0].items!;
    expect(grid.map((i) => i.library?.exists)).toEqual([false, true]);

    const film = qc.getQueryData<DiscoverDetail>(queryKeys.discoverDetail('movie', 10))!;
    expect(film.addTarget).toMatchObject({ exists: true, id: 501, instanceId: 'radarr-b' });
    expect(film.library?.exists).toBe(true);
    expect(qc.getQueryData<DiscoverDetail>(queryKeys.discoverDetail('tv', 10))!.addTarget.exists).toBe(false);
  });

  it('adds the new instance to a title already held elsewhere and keeps its link target', () => {
    const qc = new QueryClient();
    const held = { instanceId: 'radarr-a', instanceLabel: 'Radarr A', id: 7 };
    qc.setQueryData(queryKeys.discoverDetail('movie', 10), detail(10, 'radarr', {
      addTarget: { service: 'radarr', exists: true, id: 7, instanceId: 'radarr-a' },
      library: { exists: true, type: 'movie', id: 7, instanceId: 'radarr-a', instances: [held] },
    }));

    invalidateAfterLibraryAdd(qc, 'radarr', added);

    const film = qc.getQueryData<DiscoverDetail>(queryKeys.discoverDetail('movie', 10))!;
    expect(film.addTarget).toEqual({ service: 'radarr', exists: true, id: 7, instanceId: 'radarr-a' });
    expect(film.library?.instances).toEqual([held, { instanceId: 'radarr-b', instanceLabel: 'Radarr B', id: 501, titleSlug: 't10' }]);
  });

  it('flips the Anime page by TVDB id for a series and leaves an Anime film alone', () => {
    const qc = new QueryClient();
    qc.setQueryData(['anime', 'detail', 1], { id: 1, format: 'TV', tvdbId: 99, tmdbId: 10, library: null });
    qc.setQueryData(['anime', 'detail', 2], { id: 2, format: 'MOVIE', tvdbId: 99, tmdbId: 10, library: null });

    invalidateAfterLibraryAdd(qc, 'sonarr', { id: 8, tvdbId: 99, tmdbId: 10, instanceId: 'sonarr-a' });

    expect(qc.getQueryData<{ library: unknown }>(['anime', 'detail', 1])!.library).toMatchObject({ exists: true, type: 'series', id: 8 });
    expect(qc.getQueryData<{ library: unknown }>(['anime', 'detail', 2])!.library).toBeNull();
  });

  it('then refetches what holds library state, and leaves filters, layout and credits cached', () => {
    const qc = seed();
    const before = qc.getQueryState(queryKeys.discover('layout'))!.dataUpdatedAt;
    invalidateAfterLibraryAdd(qc, 'radarr', added);

    const invalidated = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated;
    expect(invalidated(sectionsKey)).toBe(true);
    expect(invalidated(gridKey)).toBe(true);
    expect(invalidated(queryKeys.discoverDetail('movie', 10))).toBe(true);
    expect(invalidated(queryKeys.discover('filters'))).toBe(false);
    expect(invalidated(queryKeys.discover('layout'))).toBe(false);
    expect(invalidated(queryKeys.discoverCredits('movie', 10))).toBe(false);
    // An untouched query is not restamped as just fetched.
    expect(qc.getQueryState(queryKeys.discover('layout'))!.dataUpdatedAt).toBe(before);
    expect(invalidated(queryKeys.library('radarr'))).toBeUndefined();
  });
});

describe('invalidateLibraryMembership', () => {
  it('marks Discover and Anime library state stale without touching their data', () => {
    const qc = seed();
    qc.setQueryData(['anime', 'home', 20], { trending: [] });
    const sections = qc.getQueryData(sectionsKey);

    invalidateLibraryMembership(qc);

    expect(qc.getQueryData(sectionsKey)).toBe(sections);
    expect(qc.getQueryState(sectionsKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['anime', 'home', 20])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(queryKeys.discover('filters'))?.isInvalidated).toBe(false);
  });
});

describe('invalidateAfterLibraryRemove', () => {
  const heldIn = (copies: Array<{ instanceId: string; id: number }>) => ({
    exists: true as const, type: 'movie' as const, id: copies[0].id, instanceId: copies[0].instanceId,
    instances: copies.map((c) => ({ ...c, instanceLabel: c.instanceId })),
  });

  it('takes a deleted copy out at once: the title leaves the library, or its next copy becomes the link', () => {
    const qc = new QueryClient();
    qc.setQueryData<DiscoverResponse>(sectionsKey, {
      mode: 'sections',
      sections: [{ key: 'trending', title: 'Trending', type: 'media', items: [
        item(10, 'movie', { library: heldIn([{ instanceId: 'radarr-a', id: 7 }]) }),
        item(11, 'movie', { library: heldIn([{ instanceId: 'radarr-a', id: 7 }, { instanceId: 'radarr-b', id: 3 }]) }),
        // Same id in another instance, and a show with that id: neither is the deleted copy.
        item(12, 'movie', { library: heldIn([{ instanceId: 'radarr-b', id: 7 }]) }),
        item(13, 'tv', { library: { ...heldIn([{ instanceId: 'radarr-a', id: 7 }]), type: 'series' } }),
      ] }],
    });
    qc.setQueryData(queryKeys.discoverDetail('movie', 11), detail(11, 'radarr', {
      addTarget: { service: 'radarr', exists: true, id: 7, instanceId: 'radarr-a' },
      library: heldIn([{ instanceId: 'radarr-a', id: 7 }, { instanceId: 'radarr-b', id: 3 }]),
    }));
    qc.setQueryData(queryKeys.discoverDetail('movie', 10), detail(10, 'radarr', {
      addTarget: { service: 'radarr', exists: true, id: 7, instanceId: 'radarr-a', uncheckedInstanceIds: ['radarr-c'] },
      library: heldIn([{ instanceId: 'radarr-a', id: 7 }]),
    }));

    invalidateAfterLibraryRemove(qc, 'radarr', [{ id: 7, instanceId: 'radarr-a' }]);

    const items = qc.getQueryData<DiscoverResponse>(sectionsKey)!.sections![0].items as DiscoverItem[];
    expect(items[0].library).toEqual({ exists: false });
    expect(items[1].library).toMatchObject({ exists: true, id: 3, instanceId: 'radarr-b', instances: [{ instanceId: 'radarr-b', id: 3 }] });
    expect(items[2].library?.exists).toBe(true);
    expect(items[3].library?.exists).toBe(true);
    expect(qc.getQueryData<DiscoverDetail>(queryKeys.discoverDetail('movie', 11))!.addTarget)
      .toEqual({ service: 'radarr', exists: true, id: 3, instanceId: 'radarr-b' });
    expect(qc.getQueryData<DiscoverDetail>(queryKeys.discoverDetail('movie', 10))!.addTarget)
      .toEqual({ service: 'radarr', exists: false, uncheckedInstanceIds: ['radarr-c'] });
    expect(qc.getQueryState(sectionsKey)?.isInvalidated).toBe(true);
  });

  it('leaves a copy without a known instance to the refetch', () => {
    const qc = new QueryClient();
    qc.setQueryData(['anime', 'detail', 1], { id: 1, format: 'TV', library: { exists: true, type: 'series', id: 7, instanceId: 'sonarr-a' } });
    qc.setQueryData(['anime', 'detail', 2], { id: 2, format: 'TV', library: { exists: true, type: 'series', id: 8, instanceId: 'sonarr-a' } });

    invalidateAfterLibraryRemove(qc, 'sonarr', [{ id: 7 }, { id: 8, instanceId: 'sonarr-a' }]);

    expect(qc.getQueryData<{ library: { exists: boolean } }>(['anime', 'detail', 1])!.library.exists).toBe(true);
    expect(qc.getQueryData<{ library: { exists: boolean } }>(['anime', 'detail', 2])!.library).toEqual({ exists: false });
    expect(qc.getQueryState(['anime', 'detail', 1])?.isInvalidated).toBe(true);
  });
});
