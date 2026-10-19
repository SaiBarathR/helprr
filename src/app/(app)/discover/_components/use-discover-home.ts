import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import type { DiscoverFiltersResponse, DiscoverItem, DiscoverResponse, DiscoverSection } from '@/types';
import { validateDiscoverLayout } from '@/lib/discover-layout-config';
import { buildCustomCarouselParams, discoverFetch } from './discover-data';

/** The Discover home's data: carousels, filter choices, the saved layout and its custom carousels. */
export function useDiscoverHome(discoverContentType: 'all' | 'movie' | 'show', carouselItemLimit: number) {
  // Sections, filters meta and layout config (replaces fetchSections /
  // fetchFiltersMeta / fetchLayoutConfig + the mount effect). 60s staleTime keeps
  // carousels warm across navigation; layout config is cross-device server state
  // so it refetches on mount (staleTime 0). discoverFetch surfaces TMDB 429s as
  // RateLimitError (drives the banner below) instead of an error screen.
  const sectionsQuery = useQuery({
    queryKey: queryKeys.discover('sections', { perSectionLimit: carouselItemLimit }),
    queryFn: ({ signal }) =>
      discoverFetch<DiscoverResponse>(`/api/discover?mode=sections&perSectionLimit=${carouselItemLimit}`, signal),
    select: (data: DiscoverResponse) => data.sections ?? [],
    staleTime: 60_000,
    retry: false,
  });
  const filtersMetaQuery = useQuery({
    queryKey: queryKeys.discover('filters'),
    queryFn: ({ signal }) => discoverFetch<DiscoverFiltersResponse>('/api/discover/filters', signal),
    staleTime: 60_000,
    retry: false,
  });
  const layoutConfigQuery = useQuery({
    queryKey: queryKeys.discover('layout'),
    queryFn: ({ signal }) => discoverFetch<unknown>('/api/settings/discover-layout', signal),
    select: (data: unknown) => validateDiscoverLayout(data),
    staleTime: 0,
    retry: false,
  });

  // useMemo keeps a stable [] reference when data is absent, so the downstream
  // visibleSections/heroItems memos don't recompute on every render.
  const sections = useMemo(() => sectionsQuery.data ?? [], [sectionsQuery.data]);
  const filtersMeta = filtersMetaQuery.data ?? null;
  const layoutConfig = layoutConfigQuery.data ?? null;
  const loadingSections = sectionsQuery.isLoading;

  // Layout-aware visible sections: respects user-configured order, visibility, and content type filter
  const visibleSections = useMemo(() => {
    // If no layout config yet, fall back to original logic
    if (!layoutConfig) {
      if (discoverContentType === 'all') return sections;
      return sections.filter((section) => {
        if (!section.mediaType || section.mediaType === 'all') return section.key === 'providers';
        if (discoverContentType === 'movie') return section.mediaType === 'movie';
        if (discoverContentType === 'show') return section.mediaType === 'tv';
        return true;
      });
    }

    // Build a quick lookup of API sections by key
    const sectionsByKey = new Map(sections.map((s) => [s.key, s]));

    // Walk the layout config in order, only include enabled built-in sections that exist
    const ordered: DiscoverSection[] = [];
    for (const entry of layoutConfig.sections) {
      if (!entry.enabled) continue;
      if (entry.type === 'builtin') {
        const apiSection = sectionsByKey.get(entry.id);
        if (!apiSection) continue;

        // Apply content type filter
        if (discoverContentType !== 'all') {
          if (!apiSection.mediaType || apiSection.mediaType === 'all') {
            if (apiSection.key !== 'providers') continue;
          } else if (discoverContentType === 'movie' && apiSection.mediaType !== 'movie') continue;
          else if (discoverContentType === 'show' && apiSection.mediaType !== 'tv') continue;
        }

        ordered.push(apiSection);
      }
      // Custom sections are rendered separately via customCarouselEntries
    }

    return ordered;
  }, [sections, layoutConfig, discoverContentType]);

  // Hero carousel: top trending items that have a backdrop to show.
  const heroItems = useMemo(() => {
    const trending = sections.find((s) => s.key === 'trending' && s.type === 'media');
    const items = (trending?.items ?? []) as DiscoverItem[];
    return items.filter((item) => item.backdropPath).slice(0, 5);
  }, [sections]);

  // Custom carousel entries from layout config (enabled custom sections in order)
  const customCarouselEntries = useMemo(() => {
    if (!layoutConfig) return [];
    return layoutConfig.sections.filter(
      (s) => s.type === 'custom' && s.enabled && s.filters
    );
  }, [layoutConfig]);

  // One query per custom carousel entry (replaces the per-entry fetch +
  // carouselFetchStartedRef de-dupe hack — keying per entry id+filters is exactly
  // what that ref hand-rolled). useQueries handles the dynamic list as one hook.
  const customResults = useQueries({
    queries: customCarouselEntries.map((entry) => ({
      queryKey: queryKeys.discover('custom', { id: entry.id, filters: entry.filters }),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        discoverFetch<DiscoverResponse>(
          `/api/discover?${buildCustomCarouselParams(entry.filters!, carouselItemLimit).toString()}`,
          signal,
        ),
      select: (data: DiscoverResponse) => (data.items ?? []).slice(0, carouselItemLimit),
      staleTime: 60_000,
      retry: false,
    })),
  });

  const customCarouselItems = useMemo(() => {
    const map: Record<string, DiscoverItem[]> = {};
    customCarouselEntries.forEach((entry, i) => {
      map[entry.id] = customResults[i]?.data ?? [];
    });
    return map;
  }, [customCarouselEntries, customResults]);

  const customCarouselLoading = useMemo(() => {
    const map: Record<string, boolean> = {};
    customCarouselEntries.forEach((entry, i) => {
      map[entry.id] = customResults[i]?.isLoading ?? true;
    });
    return map;
  }, [customCarouselEntries, customResults]);

  return {
    sectionsQuery,
    filtersMetaQuery,
    customResults,
    filtersMeta,
    layoutConfig,
    loadingSections,
    visibleSections,
    heroItems,
    customCarouselItems,
    customCarouselLoading,
  };
}
