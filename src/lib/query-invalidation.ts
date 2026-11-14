// Post-mutation refresh, one rule applied everywhere: an action on an entity
// refetches that entity's own detail + the list it lives in — nothing else.
//
// Granularity matters for load: the list is the [svc, 'library'] PREFIX (catches
// slim + full + every instance), never the bare [svc] prefix — that would also
// refetch reference data (quality profiles / tags / root folders) that hooks
// deliberately hold at a long staleTime. Call these AFTER any optimistic
// setQueryData/removeQueries the handler already does; invalidateQueries only
// refetches mounted queries, so off-screen views just go stale and repaint from
// cache on next visit.

import type { QueryClient } from '@tanstack/react-query';
import { queryKeys, type ArrService } from '@/lib/query-keys';
import { isMovieFormat } from '@/lib/anilist-helpers';
import type { DiscoverLibraryStatus } from '@/types';
import type { AniListMediaFormat } from '@/types/anilist';

function invalidateArr(
  qc: QueryClient,
  svc: ArrService,
  t: { itemId?: number; instanceId?: string } = {},
) {
  qc.invalidateQueries({ queryKey: [svc, 'library'] }); // the list (slim + full, all instances)
  qc.invalidateQueries({ queryKey: [svc, 'rename'] }); // rename previews derive from the files
  qc.invalidateQueries({ queryKey: [svc, 'history'] }); // per-item history on the files pages
  if (t.itemId != null) {
    // the detail
    qc.invalidateQueries({ queryKey: queryKeys.detail(svc, t.itemId, t.instanceId) });
    qc.invalidateQueries({ queryKey: queryKeys.credits(svc, t.itemId, t.instanceId) });
    if (svc === 'sonarr') {
      qc.invalidateQueries({ queryKey: ['sonarr', 'episodes'] }); // slim + withfile variants
      qc.invalidateQueries({ queryKey: queryKeys.anime(t.itemId, t.instanceId) });
    }
    if (svc === 'lidarr') {
      qc.invalidateQueries({ queryKey: ['lidarr', 'albums'] }); // per-artist album lists
    }
  }
}

export const invalidateSeries = (qc: QueryClient, t: { itemId?: number; instanceId?: string } = {}) =>
  invalidateArr(qc, 'sonarr', t);
export const invalidateMovies = (qc: QueryClient, t: { itemId?: number; instanceId?: string } = {}) =>
  invalidateArr(qc, 'radarr', t);
export const invalidateMusic = (qc: QueryClient, t: { itemId?: number; instanceId?: string } = {}) =>
  invalidateArr(qc, 'lidarr', t);

// Discover and Anime mark each title in or out of the library. The server works
// that out on every request from the library cache the add and delete routes
// reset, so once a title joins or leaves a library their cached pages are stale.
// Mark them stale: a page on screen refetches now and the rest when shown next,
// Back included. Filters, layout and credits hold no library state.
export function invalidateLibraryMembership(qc: QueryClient) {
  qc.invalidateQueries({
    queryKey: ['discover'],
    predicate: ({ queryKey }) =>
      queryKey[1] !== 'filters' && queryKey[1] !== 'layout' && queryKey[3] !== 'credits',
  });
  qc.invalidateQueries({ queryKey: ['anime'] });
}

/** The title an add page just created, as Sonarr/Radarr returned it. */
export interface AddedLibraryTitle {
  id: number;
  tmdbId?: number;
  tvdbId?: number;
  titleSlug?: string;
  instanceId?: string;
  instanceLabel?: string;
}

// The cached library state with the new copy added: a title that was missing
// becomes present, and one already held elsewhere gains this instance.
function withAddedInstance(
  library: DiscoverLibraryStatus | undefined,
  svc: 'radarr' | 'sonarr',
  added: AddedLibraryTitle,
): DiscoverLibraryStatus {
  const instance = {
    instanceId: added.instanceId ?? '',
    instanceLabel: added.instanceLabel ?? '',
    id: added.id,
    titleSlug: added.titleSlug,
  };
  if (library?.exists) {
    const instances = library.instances ?? [];
    return instances.some((i) => i.instanceId === instance.instanceId)
      ? library
      : { ...library, instances: [...instances, instance] };
  }
  return {
    exists: true,
    type: svc === 'radarr' ? 'movie' : 'series',
    id: added.id,
    titleSlug: added.titleSlug,
    tmdbId: added.tmdbId,
    instanceId: added.instanceId,
    instances: [instance],
  };
}

type Patchable = Record<string, unknown>;
type DiscoverDetailTarget = {
  service?: string;
  exists?: boolean;
  id?: number;
  instanceId?: string;
  uncheckedInstanceIds?: string[];
};

// Run `edit` over every title in a cached Discover response: a detail page (the
// title itself), a sections bundle, a browse list or an infinite grid. `edit`
// returns the same object for a title it leaves alone, and a response with no
// edited title comes back as the same object.
function mapDiscoverTitles(data: unknown, edit: (title: Patchable) => Patchable): unknown {
  if (!data || typeof data !== 'object') return data;
  const d = data as Patchable;
  const mapItems = (items: unknown[]) => {
    let changed = false;
    const next = items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const edited = edit(item as Patchable);
      if (edited !== item) changed = true;
      return edited;
    });
    return changed ? next : items;
  };
  if (Array.isArray(d.pages)) {
    const pages = d.pages.map((page) => mapDiscoverTitles(page, edit));
    return pages.some((page, i) => page !== (d.pages as unknown[])[i]) ? { ...d, pages } : data;
  }
  if (d.addTarget && typeof d.addTarget === 'object') return edit(d);
  if (Array.isArray(d.items)) {
    const items = mapItems(d.items);
    return items === d.items ? data : { ...d, items };
  }
  if (Array.isArray(d.sections)) {
    let changed = false;
    const sections = d.sections.map((section: Patchable) => {
      if (section?.type !== 'media' || !Array.isArray(section.items)) return section;
      const items = mapItems(section.items);
      if (items === section.items) return section;
      changed = true;
      return { ...section, items };
    });
    return changed ? { ...d, sections } : data;
  }
  return data;
}

const discoverMediaType = (svc: 'radarr' | 'sonarr') => (svc === 'radarr' ? 'movie' : 'tv');

// A Discover title matches an added one by TMDB id and kind.
const addToDiscoverTitle = (svc: 'radarr' | 'sonarr', added: AddedLibraryTitle) => (t: Patchable): Patchable => {
  if (added.tmdbId == null || t.mediaType !== discoverMediaType(svc) || t.tmdbId !== added.tmdbId) return t;
  const target = t.addTarget as DiscoverDetailTarget | undefined;
  if (target && target.service !== svc) return t;
  return {
    ...t,
    library: withAddedInstance(t.library as DiscoverLibraryStatus | undefined, svc, added),
    // A title already held elsewhere keeps its first copy as the link target.
    ...(target ? { addTarget: target.exists ? target : { ...target, exists: true, id: added.id, instanceId: added.instanceId } } : {}),
  };
};

/** A title a delete just removed: its Sonarr/Radarr id within that instance. */
export interface RemovedLibraryTitle {
  id: number;
  instanceId: string;
}

// The cached library state without the removed copy: the next copy becomes the
// link target, and with none left the title is out of the library. Ids are per
// instance, so a copy matches on id AND instance.
function withoutInstance(library: DiscoverLibraryStatus | undefined, removed: RemovedLibraryTitle) {
  if (!library?.exists) return library;
  const instances = library.instances
    ?? (library.id != null ? [{ instanceId: library.instanceId ?? '', instanceLabel: '', id: library.id, titleSlug: library.titleSlug }] : []);
  const rest = instances.filter((i) => !(i.id === removed.id && i.instanceId === removed.instanceId));
  if (rest.length === instances.length) return library;
  if (rest.length === 0) return { exists: false };
  return { ...library, id: rest[0].id, instanceId: rest[0].instanceId, titleSlug: rest[0].titleSlug, instances: rest };
}

const removeFromDiscoverTitle = (svc: 'radarr' | 'sonarr', removed: RemovedLibraryTitle) => (t: Patchable): Patchable => {
  if (t.mediaType !== discoverMediaType(svc)) return t;
  const target = t.addTarget as DiscoverDetailTarget | undefined;
  if (target && target.service !== svc) return t;
  const before = t.library as DiscoverLibraryStatus | undefined;
  const library = withoutInstance(before, removed);
  if (library === before) return t;
  return {
    ...t,
    library,
    ...(target ? {
      addTarget: library?.exists
        ? { ...target, id: library.id, instanceId: library.instanceId }
        : { service: target.service, exists: false, uncheckedInstanceIds: target.uncheckedInstanceIds },
    } : {}),
  };
};

// An Anime film goes to Radarr by its TMDB id and anything else to Sonarr by its
// TVDB id, the ids its add button hands the add page.
function patchAnimeDetail(
  data: unknown,
  svc: 'radarr' | 'sonarr',
  change: { added: AddedLibraryTitle } | { removed: RemovedLibraryTitle },
): unknown {
  if (!data || typeof data !== 'object') return data;
  const d = data as Patchable;
  const isMovie = isMovieFormat((d.format ?? null) as AniListMediaFormat | null);
  if (isMovie !== (svc === 'radarr')) return data;
  const library = (d.library ?? undefined) as DiscoverLibraryStatus | undefined;
  if ('removed' in change) {
    const next = withoutInstance(library, change.removed);
    return next === library ? data : { ...d, library: next };
  }
  const { added } = change;
  const matches = svc === 'radarr'
    ? added.tmdbId != null && d.tmdbId === added.tmdbId
    : added.tvdbId != null && d.tvdbId === added.tvdbId;
  return matches ? { ...d, library: withAddedInstance(library, svc, added) } : data;
}

// Returning undefined leaves a query untouched: writing back the same data would
// still restamp it as just fetched.
function patchQueries(qc: QueryClient, queryKey: readonly unknown[], fn: (data: unknown) => unknown) {
  qc.setQueriesData<unknown>({ queryKey }, (prev: unknown) => {
    const next = fn(prev);
    return next === prev ? undefined : next;
  });
}

// After an add: show the title as in the library at once on every cached Discover
// page and on its Anime page, so Back lands on the new state, then refetch them
// all in the background for the server's own answer.
export function invalidateAfterLibraryAdd(qc: QueryClient, svc: 'radarr' | 'sonarr', added: AddedLibraryTitle) {
  invalidateArr(qc, svc);
  patchQueries(qc, ['discover'], (data) => mapDiscoverTitles(data, addToDiscoverTitle(svc, added)));
  patchQueries(qc, ['anime', 'detail'], (data) => patchAnimeDetail(data, svc, { added }));
  invalidateLibraryMembership(qc);
}

// After a delete: take the removed copies out of every cached Discover page and
// Anime page at once, so none still links to a deleted id, then refetch them.
// Without an instance a copy can't be matched (ids are per instance), so it is
// left to the refetch. The Sonarr/Radarr lists are the caller's to refresh.
export function invalidateAfterLibraryRemove(
  qc: QueryClient,
  svc: 'radarr' | 'sonarr',
  removed: Array<{ id: number; instanceId?: string }>,
) {
  for (const { id, instanceId } of removed) {
    if (!instanceId) continue;
    const copy = { id, instanceId };
    patchQueries(qc, ['discover'], (data) => mapDiscoverTitles(data, removeFromDiscoverTitle(svc, copy)));
    patchQueries(qc, ['anime', 'detail'], (data) => patchAnimeDetail(data, svc, { removed: copy }));
  }
  invalidateLibraryMembership(qc);
}

// Collections derive from the movie library, so a collection action (monitor toggle,
// add-missing) can change both. Refetch the collections list and the movie library.
export function invalidateCollections(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['radarr', 'collections'] });
  qc.invalidateQueries({ queryKey: ['radarr', 'library'] });
}

// Activity: queue / history / wanted / manual-import all share the ['activity'] prefix.
export const invalidateActivity = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: ['activity'] });

// Service connections appear in two lists: the settings list (queryKeys.instances())
// and the pickers and filters that read /api/instances (queryKeys.arrInstances(), a separate key).
// An added, re-pointed or removed instance also changes the libraries.
export function invalidateInstances(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: queryKeys.instances() });
  // Add pages pick their starting instance from this list once, so drop it rather
  // than mark it stale: a page opened next must not start from the old default.
  qc.resetQueries({ queryKey: queryKeys.arrInstances() });
  qc.invalidateQueries({ queryKey: queryKeys.widgetServiceAvailability() });
  for (const svc of ['radarr', 'sonarr', 'lidarr'] as const) qc.invalidateQueries({ queryKey: [svc, 'library'] });
}

// After a monitor toggle, patch that one item's flag in the cached library lists
// (slim + full + every instance) instead of refetching the whole library, which
// keeps the server-resolved profile/tag labels. Ids are per instance, so match
// on id AND instanceId: another instance can hold a different item with the same
// id. Without an instanceId the write went to the default connection, which a
// list item cannot be matched to, so refetch the lists instead.
export function patchLibraryMonitored(
  qc: QueryClient,
  svc: ArrService,
  t: { itemId: number; instanceId?: string; monitored: boolean },
) {
  if (!t.instanceId) {
    qc.invalidateQueries({ queryKey: [svc, 'library'] });
    return;
  }
  qc.setQueriesData<unknown>({ queryKey: [svc, 'library'] }, (prev: unknown) =>
    Array.isArray(prev)
      ? prev.map((item: { id: number; instanceId?: string }) =>
          item.id === t.itemId && item.instanceId === t.instanceId ? { ...item, monitored: t.monitored } : item)
      : prev);
}
