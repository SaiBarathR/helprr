'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MediaCard } from '@/components/media/media-card';
import { MediaOverviewItem } from '@/components/media/media-overview';
import { MediaTable } from '@/components/media/media-table';
import { ViewSelector } from '@/components/media/view-selector';
import { FieldToggles } from '@/components/media/field-toggles';
import { SearchBar } from '@/components/media/search-bar';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Filter, ArrowUpDown, Plus, RefreshCw, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/components/permission-provider';
import { useUIStore } from '@/lib/store';
import { useBulkSelection } from '@/lib/use-bulk-selection';
import { BulkActionBar } from '@/components/media/bulk-action-bar';
import {
  getCachedListData,
  getListViewState,
  isListDataFresh,
  setCachedListData,
  setListViewState,
} from '@/lib/media-list-cache';
import type { LidarrArtistListItem } from '@/types';
import type { MediaViewMode } from '@/lib/store';

interface MusicPageCacheData {
  artists: LidarrArtistListItem[];
  qualityProfiles: { id: number; name: string }[];
  metadataProfiles: { id: number; name: string }[];
  tags: { id: number; label: string }[];
}

// Toast summary shared by every bulk action ("Monitoring 5 artists", "Deleted 2 artists, 1 failed").
function reportBulk(verb: string, ok: number, fail: number) {
  const word = ok === 1 && fail === 0 ? 'artist' : 'artists';
  if (fail) toast.error(`${verb} ${ok} ${word}, ${fail} failed`);
  else toast.success(`${verb} ${ok} ${word}`);
}

const FIELD_OPTIONS_BY_MODE: Record<MediaViewMode, { value: string; label: string }[]> = {
  posters: [
    { value: 'rating', label: 'Rating' },
    { value: 'monitored', label: 'Monitored' },
  ],
  overview: [
    { value: 'qualityProfile', label: 'Quality Profile' },
    { value: 'metadataProfile', label: 'Metadata Profile' },
    { value: 'rating', label: 'Rating' },
    { value: 'artistType', label: 'Artist Type' },
    { value: 'albumCount', label: 'Album Count' },
    { value: 'trackProgress', label: 'Track Progress' },
    { value: 'sizeOnDisk', label: 'Size on Disk' },
    { value: 'monitored', label: 'Monitored' },
    { value: 'genres', label: 'Genres' },
    { value: 'overview', label: 'Overview' },
    { value: 'images', label: 'Poster' },
  ],
  table: [
    { value: 'monitored', label: 'Monitored' },
    { value: 'artistType', label: 'Artist Type' },
    { value: 'qualityProfile', label: 'Quality Profile' },
    { value: 'albumCount', label: 'Album Count' },
    { value: 'trackProgress', label: 'Track Progress' },
    { value: 'rating', label: 'Rating' },
    { value: 'sizeOnDisk', label: 'Size on Disk' },
  ],
};

const filterOptions = [
  { value: 'monitored', label: 'Monitored' },
  { value: 'unmonitored', label: 'Unmonitored' },
  { value: 'missing', label: 'Missing tracks' },
  { value: 'complete', label: 'Complete' },
  { value: 'continuing', label: 'Continuing' },
  { value: 'ended', label: 'Ended' },
] as const;

const sortOptions = [
  { value: 'sortName', label: 'Name' },
  { value: 'dateAdded', label: 'Added' },
  { value: 'albumCount', label: 'Album Count' },
  { value: 'trackCount', label: 'Track Count' },
  { value: 'sizeOnDisk', label: 'Size on Disk' },
  { value: 'rating', label: 'Rating' },
  { value: 'qualityProfile', label: 'Quality Profile' },
  { value: 'monitored', label: 'Monitored/Status' },
  { value: 'artistType', label: 'Artist Type' },
  { value: 'path', label: 'Path' },
] as const;

function getPosterColumns(width: number, posterSize: 'small' | 'medium' | 'large') {
  if (posterSize === 'small') {
    if (width >= 1280) return 8;
    if (width >= 1024) return 7;
    if (width >= 768) return 6;
    if (width >= 640) return 5;
    return 4;
  }

  if (posterSize === 'large') {
    if (width >= 1280) return 5;
    if (width >= 1024) return 4;
    if (width >= 768) return 3;
    return 2;
  }

  if (width >= 1280) return 6;
  if (width >= 1024) return 5;
  if (width >= 768) return 4;
  return 3;
}

function ensurePaintedOrHeightReached(targetScrollY: number, timeoutMs = 1200, pollMs = 50) {
  return new Promise<void>((resolve) => {
    const startedAt = Date.now();
    let done = false;
    let loadTimeoutId: number | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (loadTimeoutId !== null) window.clearTimeout(loadTimeoutId);
      resolve();
    };

    const waitForHeight = () => {
      if (done) return;
      const maxScrollTop = Math.max(0, document.body.scrollHeight - window.innerHeight);
      const reachedHeight = maxScrollTop >= targetScrollY;
      const timedOut = Date.now() - startedAt >= timeoutMs;
      if (reachedHeight || timedOut) {
        finish();
        return;
      }
      window.setTimeout(waitForHeight, pollMs);
    };

    if (document.readyState !== 'complete') {
      const onLoad = () => {
        window.removeEventListener('load', onLoad);
        waitForHeight();
      };
      window.addEventListener('load', onLoad, { once: true });
      loadTimeoutId = window.setTimeout(() => {
        window.removeEventListener('load', onLoad);
        waitForHeight();
      }, timeoutMs);
      return;
    }

    waitForHeight();
  });
}

function trackProgressLabel(artist: LidarrArtistListItem): string {
  const s = artist.statistics;
  if (!s) return '';
  return `${s.trackFileCount}/${s.totalTrackCount}`;
}

/**
 * Music library page (artist-centric). Mirrors the Movies page: client-side data
 * loading + cache, virtualized posters/overview/table views, sticky filter/sort
 * bar, debounced search, and scroll-position restoration.
 */
export default function MusicPage() {
  const canAddMusic = useCan('music.add');
  const canMonitor = useCan('music.editMonitoring');
  const canTag = useCan('music.editTags');
  const canDelete = useCan('music.delete');
  const canSearch = useCan('activity.manage');
  const canBulk = canMonitor || canTag || canDelete || canSearch;
  const {
    selectionMode, selectedKeys, count: selectedCount,
    toggle, selectMany, clear, enter, exit,
  } = useBulkSelection();
  const [artists, setArtists] = useState<LidarrArtistListItem[]>([]);
  const [qualityProfiles, setQualityProfiles] = useState<{ id: number; name: string }[]>([]);
  const [metadataProfiles, setMetadataProfiles] = useState<{ id: number; name: string }[]>([]);
  const [tags, setTags] = useState<{ id: number; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentOffsetTop, setContentOffsetTop] = useState(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const hasRestoredScrollRef = useRef(false);
  const hasRestoredSearchRef = useRef(false);

  const {
    musicView: viewMode,
    setMusicView: setViewMode,
    musicPosterSize: posterSize,
    setMusicPosterSize: setPosterSize,
    musicSort: sort,
    setMusicSort: setSort,
    musicSortDirection: sortDir,
    setMusicSortDirection: setSortDir,
    musicFilter: filter,
    setMusicFilter: setFilter,
    musicInstanceFilter: instanceFilter,
    setMusicInstanceFilter: setInstanceFilter,
    musicVisibleFields: visibleFieldsByMode,
    setMusicVisibleFields: setVisibleFieldsForMode,
    musicSearch: search,
    setMusicSearch: setSearch,
  } = useUIStore();

  const visibleFields = visibleFieldsByMode[viewMode];
  const setVisibleFields = useCallback(
    (fields: string[]) => setVisibleFieldsForMode(viewMode, fields),
    [viewMode, setVisibleFieldsForMode]
  );
  const isDesktop = viewportWidth >= 768;

  const persistViewState = useCallback((scrollY = window.scrollY, searchValue = search) => {
    setListViewState('music', { scrollY, search: searchValue });
  }, [search]);

  const fetchData = useCallback(async (force = false) => {
    const cached = force ? null : getCachedListData<MusicPageCacheData>('music');
    const hasCachedData = Boolean(cached?.data);

    if (cached?.data) {
      setArtists(cached.data.artists);
      setQualityProfiles(cached.data.qualityProfiles);
      setMetadataProfiles(cached.data.metadataProfiles);
      setTags(cached.data.tags ?? []);
      setLoading(false);

      if (isListDataFresh(cached)) {
        setRefreshing(false);
        return;
      }

      setRefreshing(true);
    } else {
      setLoading(true);
      setRefreshing(false);
    }

    try {
      const [a, q, mp, t] = await Promise.all([
        fetch('/api/lidarr').then((r) => { if (!r.ok) throw new Error('Failed to load artists'); return r.json(); }),
        fetch('/api/lidarr/qualityprofiles').then((r) => { if (!r.ok) throw new Error('Failed to load quality profiles'); return r.json(); }),
        fetch('/api/lidarr/metadataprofiles').then((r) => { if (!r.ok) throw new Error('Failed to load metadata profiles'); return r.json(); }),
        fetch('/api/lidarr/tags').then((r) => r.ok ? r.json() : []),
      ]);

      // A misconfigured instance can answer 200 with a non-array body; never let
      // that white-screen the library — fall back to empty for any non-array.
      const next: MusicPageCacheData = {
        artists: Array.isArray(a) ? a : [],
        qualityProfiles: Array.isArray(q) ? q : [],
        metadataProfiles: Array.isArray(mp) ? mp : [],
        tags: Array.isArray(t) ? t : [],
      };

      setArtists(next.artists);
      setQualityProfiles(next.qualityProfiles);
      setMetadataProfiles(next.metadataProfiles);
      setTags(next.tags);
      setCachedListData('music', next);
    } catch {
      if (!hasCachedData) {
        setArtists([]);
        setQualityProfiles([]);
        setMetadataProfiles([]);
        setTags([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    if (hasRestoredSearchRef.current) return;
    hasRestoredSearchRef.current = true;

    const saved = getListViewState('music');
    if (!saved) return;
    if (!search && saved.search) setSearch(saved.search);
  }, [search, setSearch]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      setContainerWidth(rect.width);
      setContentOffsetTop(rect.top + window.scrollY);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [viewMode, posterSize, loading, artists.length, search, filter, isDesktop]);

  useEffect(() => {
    if (loading || hasRestoredScrollRef.current) return;

    const saved = getListViewState('music');
    if (!saved || saved.scrollY <= 0) {
      hasRestoredScrollRef.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      await ensurePaintedOrHeightReached(saved.scrollY);
      if (cancelled) return;
      window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      hasRestoredScrollRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [loading]);

  useEffect(() => {
    persistViewState(window.scrollY, search);
  }, [search, persistViewState]);

  useEffect(() => {
    let lastSaved = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastSaved < 150) return;
      lastSaved = now;
      persistViewState(window.scrollY, search);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [persistViewState, search]);

  const handleSearch = useCallback((v: string) => setSearch(v), [setSearch]);
  const handleNavigateToDetail = useCallback(() => {
    persistViewState(window.scrollY, search);
  }, [persistViewState, search]);

  const qualityProfileMap = useMemo(
    () => new Map(qualityProfiles.map((profile) => [profile.id, profile.name])),
    [qualityProfiles]
  );
  const metadataProfileMap = useMemo(
    () => new Map(metadataProfiles.map((profile) => [profile.id, profile.name])),
    [metadataProfiles]
  );

  // Connected instances derived from the (already instance-tagged) list.
  const instances = useMemo(() => {
    const map = new Map<string, string>();
    for (const artist of artists) if (artist.instanceId) map.set(artist.instanceId, artist.instanceLabel ?? artist.instanceId);
    return [...map].map(([id, label]) => ({ id, label }));
  }, [artists]);
  const multiInstance = instances.length > 1;
  const hrefForArtist = useCallback(
    (artist: LidarrArtistListItem) => (artist.instanceId ? `/music/${artist.id}?instance=${artist.instanceId}` : `/music/${artist.id}`),
    []
  );

  // Selection keys are composite so ids that repeat across instances stay distinct.
  const keyOf = useCallback((artist: LidarrArtistListItem) => `${artist.instanceId ?? ''}:${artist.id}`, []);
  const artistByKey = useMemo(() => {
    const map = new Map<string, LidarrArtistListItem>();
    for (const artist of artists) map.set(keyOf(artist), artist);
    return map;
  }, [artists, keyOf]);

  // Drop a stale instance filter if that instance is no longer connected.
  useEffect(() => {
    if (instanceFilter !== 'all' && !instances.some((i) => i.id === instanceFilter)) {
      setInstanceFilter('all');
    }
  }, [instances, instanceFilter, setInstanceFilter]);

  const filtered = useMemo(() => {
    let list = artists;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.artistName.toLowerCase().includes(q));
    }

    if (filter.length > 0) {
      list = list.filter((a) => filter.some((f) => {
        const s = a.statistics;
        if (f === 'monitored') return a.monitored;
        if (f === 'unmonitored') return !a.monitored;
        if (f === 'missing') return !!s && s.trackFileCount < s.totalTrackCount;
        if (f === 'complete') return !!s && s.totalTrackCount > 0 && s.trackFileCount >= s.totalTrackCount;
        if (f === 'continuing') return a.status === 'continuing';
        if (f === 'ended') return a.status === 'ended' || a.ended;
        return true;
      }));
    }

    if (instanceFilter !== 'all') {
      list = list.filter((artist) => artist.instanceId === instanceFilter);
    }

    list = [...list].sort((a, b) => {
      let result = 0;

      switch (sort) {
        case 'sortName':
          result = (a.sortName || a.artistName).localeCompare(b.sortName || b.artistName);
          break;
        case 'dateAdded':
          result = new Date(a.added).getTime() - new Date(b.added).getTime();
          break;
        case 'albumCount':
          result = (a.statistics?.albumCount || 0) - (b.statistics?.albumCount || 0);
          break;
        case 'trackCount':
          result = (a.statistics?.totalTrackCount || 0) - (b.statistics?.totalTrackCount || 0);
          break;
        case 'sizeOnDisk':
          result = (a.statistics?.sizeOnDisk || 0) - (b.statistics?.sizeOnDisk || 0);
          break;
        case 'rating':
          result = (a.ratings?.value || 0) - (b.ratings?.value || 0);
          break;
        case 'qualityProfile': {
          const qA = qualityProfileMap.get(a.qualityProfileId) || '';
          const qB = qualityProfileMap.get(b.qualityProfileId) || '';
          result = qA.localeCompare(qB);
          break;
        }
        case 'monitored':
          result = (a.monitored === b.monitored) ? 0 : a.monitored ? -1 : 1;
          break;
        case 'artistType':
          result = (a.artistType || '').localeCompare(b.artistType || '');
          break;
        case 'path':
          result = (a.path || '').localeCompare(b.path || '');
          break;
        default:
          result = 0;
      }

      return sortDir === 'asc' ? result : -result;
    });

    return list;
  }, [artists, search, sort, sortDir, filter, instanceFilter, qualityProfileMap]);

  // ── Bulk selection ────────────────────────────────────────────────────────
  const allFilteredSelected = filtered.length > 0 && filtered.every((a) => selectedKeys.has(keyOf(a)));
  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) clear();
    else selectMany(filtered.map(keyOf));
  }, [allFilteredSelected, clear, selectMany, filtered, keyOf]);

  // Selected artists grouped by instance so each bulk request hits the right one.
  const groupSelectedByInstance = useCallback(() => {
    const groups = new Map<string | undefined, number[]>();
    for (const key of selectedKeys) {
      const artist = artistByKey.get(key);
      if (!artist) continue;
      const list = groups.get(artist.instanceId) ?? [];
      list.push(artist.id);
      groups.set(artist.instanceId, list);
    }
    return groups;
  }, [selectedKeys, artistByKey]);

  const fanOut = useCallback(async (
    run: (instanceId: string | undefined, ids: number[]) => Promise<Response>
  ) => {
    let ok = 0;
    let fail = 0;
    await Promise.all([...groupSelectedByInstance()].map(async ([instanceId, ids]) => {
      try {
        const res = await run(instanceId, ids);
        if (res.ok) ok += ids.length;
        else fail += ids.length;
      } catch {
        fail += ids.length;
      }
    }));
    return { ok, fail };
  }, [groupSelectedByInstance]);

  const handleMonitor = useCallback(async (monitored: boolean) => {
    const { ok, fail } = await fanOut((instanceId, ids) =>
      fetch(`/api/lidarr/editor${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, monitored }),
      }));
    reportBulk(monitored ? 'Monitoring' : 'Unmonitored', ok, fail);
    await fetchData(true);
    exit();
  }, [fanOut, fetchData, exit]);

  const handleApplyTags = useCallback(async (labels: string[], mode: 'add' | 'remove') => {
    const { ok, fail } = await fanOut((instanceId, ids) =>
      fetch(`/api/lidarr/editor${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, tags: labels, applyTags: mode }),
      }));
    reportBulk(mode === 'add' ? 'Tagged' : 'Untagged', ok, fail);
    await fetchData(true);
    exit();
  }, [fanOut, fetchData, exit]);

  const handleBulkSearch = useCallback(async () => {
    const { ok, fail } = await fanOut((instanceId, ids) =>
      fetch(`/api/lidarr/command${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ArtistSearch', artistIds: ids }),
      }));
    reportBulk('Searching', ok, fail);
    exit();
  }, [fanOut, exit]);

  const handleDelete = useCallback(async (deleteFiles: boolean) => {
    const { ok, fail } = await fanOut((instanceId, ids) =>
      fetch(`/api/lidarr/editor${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, deleteFiles }),
      }));
    reportBulk('Deleted', ok, fail);
    await fetchData(true);
    exit();
  }, [fanOut, fetchData, exit]);

  const effectiveView = viewMode === 'table' ? 'table' : viewMode;
  const useVirtualization = !loading && filtered.length > 0;

  const posterGridClass = posterSize === 'small'
    ? 'grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2'
    : posterSize === 'large'
      ? 'grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3'
      : 'grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3';

  const posterColumns = getPosterColumns(viewportWidth, posterSize);
  const posterGap = posterSize === 'small' ? 8 : 12;
  const posterRowHeight = useMemo(() => {
    if (containerWidth <= 0) {
      if (posterSize === 'small') return 148;
      if (posterSize === 'large') return 264;
      return 216;
    }

    const cardWidth = Math.max(1, (containerWidth - posterGap * (posterColumns - 1)) / posterColumns);
    return cardWidth * 1.5 + posterGap;
  }, [containerWidth, posterColumns, posterGap, posterSize]);

  const posterRowCount = Math.ceil(filtered.length / posterColumns);
  const posterVirtualizer = useWindowVirtualizer({
    count: posterRowCount,
    estimateSize: () => posterRowHeight,
    enabled: useVirtualization && effectiveView === 'posters',
    overscan: 2,
    scrollMargin: contentOffsetTop,
  });

  const overviewRowHeight = useMemo(() => {
    let base = posterSize === 'small' ? 92 : posterSize === 'large' ? 168 : 124;
    if (visibleFields.includes('overview')) base += 24;
    if (!visibleFields.includes('images')) base -= 20;
    return base;
  }, [posterSize, visibleFields]);

  const overviewVirtualizer = useWindowVirtualizer({
    count: filtered.length,
    estimateSize: () => overviewRowHeight,
    enabled: useVirtualization && effectiveView === 'overview',
    overscan: 6,
    scrollMargin: contentOffsetTop,
  });

  const tableRowHeight = 44;
  const tableRows = useMemo(() => (
    filtered.map((artist) => ({
      id: artist.id,
      title: artist.artistName,
      year: 0,
      href: hrefForArtist(artist),
      instanceId: artist.instanceId,
      instanceLabel: multiInstance ? artist.instanceLabel : undefined,
      monitored: artist.monitored,
      hasFile: !!artist.statistics && artist.statistics.totalTrackCount > 0
        && artist.statistics.trackFileCount >= artist.statistics.totalTrackCount,
      status: artist.status,
      images: artist.images,
      qualityProfile: qualityProfileMap.get(artist.qualityProfileId),
      rating: artist.ratings?.value,
      sizeOnDisk: artist.statistics?.sizeOnDisk,
      artistType: artist.artistType,
      albumCount: artist.statistics?.albumCount,
      trackProgress: trackProgressLabel(artist),
    }))
  ), [filtered, qualityProfileMap, multiInstance, hrefForArtist]);

  const tableVirtualizer = useWindowVirtualizer({
    count: tableRows.length,
    estimateSize: () => tableRowHeight,
    enabled: useVirtualization && effectiveView === 'table' && isDesktop,
    overscan: 12,
    scrollMargin: contentOffsetTop,
  });

  const mobileOverviewFields = visibleFieldsByMode.overview;
  const tableMobileOverviewRowHeight = useMemo(() => {
    let base = posterSize === 'small' ? 92 : posterSize === 'large' ? 168 : 124;
    if (mobileOverviewFields.includes('overview')) base += 24;
    if (!mobileOverviewFields.includes('images')) base -= 20;
    return base;
  }, [mobileOverviewFields, posterSize]);

  const tableMobileVirtualizer = useWindowVirtualizer({
    count: filtered.length,
    estimateSize: () => tableMobileOverviewRowHeight,
    enabled: useVirtualization && effectiveView === 'table' && !isDesktop,
    overscan: 6,
    scrollMargin: contentOffsetTop,
  });

  const activeFilterLabel = filter.length === 0
    ? 'All'
    : filter.length === 1
      ? filterOptions.find((o) => o.value === filter[0])?.label ?? filter[0]
      : `${filter.length} filters`;
  const activeSortLabel = sortOptions.find((o) => o.value === sort)?.label ?? 'Name';

  function renderOverviewItem(artist: LidarrArtistListItem, fields: string[]) {
    return (
      <MediaOverviewItem
        key={`${artist.instanceId ?? ''}:${artist.id}`}
        title={artist.artistName}
        year={0}
        images={artist.images}
        href={hrefForArtist(artist)}
        type="artist"
        monitored={artist.monitored}
        status={artist.status}
        visibleFields={fields}
        posterSize={posterSize}
        qualityProfile={qualityProfileMap.get(artist.qualityProfileId)}
        metadataProfile={metadataProfileMap.get(artist.metadataProfileId)}
        artistType={artist.artistType}
        albumCount={artist.statistics?.albumCount}
        trackProgress={trackProgressLabel(artist)}
        overview={artist.overview}
        rating={artist.ratings?.value}
        sizeOnDisk={artist.statistics?.sizeOnDisk}
        genres={artist.genres}
        instanceLabel={multiInstance ? artist.instanceLabel : undefined}
        onNavigate={handleNavigateToDetail}
        selectable={selectionMode}
        selected={selectedKeys.has(keyOf(artist))}
        onToggleSelect={() => toggle(keyOf(artist))}
      />
    );
  }

  return (
    <div className="space-y-3 animate-content-in">
      <div className="sticky z-30 -mx-2 px-2 pt-1 pb-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6 space-y-2" style={{ top: 'var(--header-height, 0px)' }}>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
                aria-label={`Filter: ${activeFilterLabel}`}
              >
                <Filter className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Filter</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={filter.length === 0}
                onCheckedChange={() => setFilter([])}
                onSelect={(e) => e.preventDefault()}
              >
                All
              </DropdownMenuCheckboxItem>
              {filterOptions.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={filter.includes(opt.value)}
                  onCheckedChange={() => setFilter(
                    filter.includes(opt.value)
                      ? filter.filter((f) => f !== opt.value)
                      : [...filter, opt.value]
                  )}
                  onSelect={(e) => e.preventDefault()}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
              {multiInstance && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Instance</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={instanceFilter === 'all'}
                    onCheckedChange={() => setInstanceFilter('all')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    All instances
                  </DropdownMenuCheckboxItem>
                  {instances.map((inst) => (
                    <DropdownMenuCheckboxItem
                      key={inst.id}
                      checked={instanceFilter === inst.id}
                      onCheckedChange={() => setInstanceFilter(inst.id)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {inst.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
                aria-label={`Sort: ${activeSortLabel} ${sortDir === 'asc' ? 'Ascending' : 'Descending'}`}
              >
                <ArrowUpDown className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel>Sort By</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {sortOptions.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={sort === opt.value}
                  onCheckedChange={() => setSort(opt.value)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={sortDir === 'asc'}
                onCheckedChange={() => setSortDir('asc')}
                onSelect={(e) => e.preventDefault()}
              >
                Ascending
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortDir === 'desc'}
                onCheckedChange={() => setSortDir('desc')}
                onSelect={(e) => e.preventDefault()}
              >
                Descending
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ViewSelector value={viewMode} onChange={setViewMode} />
          <FieldToggles
            available={FIELD_OPTIONS_BY_MODE[viewMode]}
            selected={visibleFields}
            onChange={setVisibleFields}
            posterSize={viewMode !== 'table' ? posterSize : undefined}
            onPosterSizeChange={viewMode !== 'table' ? setPosterSize : undefined}
          />

          <div className="flex-1" />

          {canBulk && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => (selectionMode ? exit() : enter())}
                  className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${
                    selectionMode ? 'bg-primary text-primary-foreground' : 'hover:bg-accent active:bg-accent/80'
                  }`}
                  aria-label={selectionMode ? 'Exit selection' : 'Select artists'}
                  aria-pressed={selectionMode}
                >
                  <ListChecks className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{selectionMode ? 'Exit selection' : 'Select'}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => fetchData(true)}
                disabled={refreshing}
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
                aria-label="Refresh Music"
              >
                <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Refresh Music</TooltipContent>
          </Tooltip>

          {canAddMusic && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/music/add"
                  className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
                  aria-label="Add Artist"
                >
                  <Plus className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent>Add Artist</TooltipContent>
            </Tooltip>
          )}
        </div>

        <SearchBar value={search} onChange={handleSearch} placeholder="Search artists..." />
      </div>

      {(() => {
        if (loading) {
          return <PageSpinner />;
        }

        if (filtered.length === 0) {
          return (
            <div className="text-center py-12 text-muted-foreground">
              {artists.length === 0
                ? 'No artists found. Add your Lidarr connection in Settings.'
                : 'No artists match your filters.'}
            </div>
          );
        }

        if (effectiveView === 'posters') {
          const virtualRows = posterVirtualizer.getVirtualItems();
          const firstRow = virtualRows[0];
          const lastRow = virtualRows[virtualRows.length - 1];
          const startIndex = (firstRow?.index ?? 0) * posterColumns;
          const endIndex = Math.min(filtered.length, ((lastRow?.index ?? 0) + 1) * posterColumns);
          const visibleArtists = filtered.slice(startIndex, endIndex);
          const topSpacerHeight = firstRow ? Math.max(0, firstRow.start - contentOffsetTop) : 0;
          const bottomSpacerHeight = lastRow
            ? Math.max(0, posterVirtualizer.getTotalSize() - (lastRow.end - contentOffsetTop))
            : 0;

          return (
            <div ref={contentRef}>
              {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
              <div className={posterGridClass}>
                {visibleArtists.map((artist) => (
                  <MediaCard
                    key={`${artist.instanceId ?? ''}:${artist.id}`}
                    title={artist.artistName}
                    year={0}
                    images={artist.images}
                    hasFile={!!artist.statistics && artist.statistics.totalTrackCount > 0
                      && artist.statistics.trackFileCount >= artist.statistics.totalTrackCount}
                    monitored={artist.monitored}
                    type="artist"
                    href={hrefForArtist(artist)}
                    visibleFields={visibleFields}
                    rating={artist.ratings?.value}
                    instanceLabel={multiInstance ? artist.instanceLabel : undefined}
                    onNavigate={handleNavigateToDetail}
                    selectable={selectionMode}
                    selected={selectedKeys.has(keyOf(artist))}
                    onToggleSelect={() => toggle(keyOf(artist))}
                  />
                ))}
              </div>
              {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
            </div>
          );
        }

        if (effectiveView === 'overview') {
          const virtualRows = overviewVirtualizer.getVirtualItems();
          const firstRow = virtualRows[0];
          const lastRow = virtualRows[virtualRows.length - 1];
          const startIndex = firstRow?.index ?? 0;
          const endIndex = (lastRow?.index ?? 0) + 1;
          const visibleArtists = filtered.slice(startIndex, endIndex);
          const topSpacerHeight = firstRow ? Math.max(0, firstRow.start - contentOffsetTop) : 0;
          const bottomSpacerHeight = lastRow
            ? Math.max(0, overviewVirtualizer.getTotalSize() - (lastRow.end - contentOffsetTop))
            : 0;

          return (
            <div ref={contentRef} className="space-y-2">
              {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
              {visibleArtists.map((artist) => renderOverviewItem(artist, visibleFields))}
              {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
            </div>
          );
        }

        if (isDesktop) {
          const virtualRows = tableVirtualizer.getVirtualItems();
          const firstRow = virtualRows[0];
          const lastRow = virtualRows[virtualRows.length - 1];
          const startIndex = firstRow?.index ?? 0;
          const endIndex = (lastRow?.index ?? 0) + 1;
          const visibleRows = tableRows.slice(startIndex, endIndex);
          const topSpacerHeight = firstRow ? Math.max(0, firstRow.start - contentOffsetTop) : 0;
          const bottomSpacerHeight = lastRow
            ? Math.max(0, tableVirtualizer.getTotalSize() - (lastRow.end - contentOffsetTop))
            : 0;
          return (
            <div ref={contentRef}>
              <MediaTable
                type="artist"
                visibleFields={visibleFields}
                rows={visibleRows}
                topSpacerHeight={topSpacerHeight}
                bottomSpacerHeight={bottomSpacerHeight}
                onNavigate={handleNavigateToDetail}
                selectable={selectionMode}
                selectedKeys={selectedKeys}
                onToggleSelect={(row) => toggle(`${row.instanceId ?? ''}:${row.id}`)}
              />
            </div>
          );
        }

        const virtualRows = tableMobileVirtualizer.getVirtualItems();
        const firstRow = virtualRows[0];
        const lastRow = virtualRows[virtualRows.length - 1];
        const startIndex = firstRow?.index ?? 0;
        const endIndex = (lastRow?.index ?? 0) + 1;
        const visibleArtists = filtered.slice(startIndex, endIndex);
        const topSpacerHeight = firstRow ? Math.max(0, firstRow.start - contentOffsetTop) : 0;
        const bottomSpacerHeight = lastRow
          ? Math.max(0, tableMobileVirtualizer.getTotalSize() - (lastRow.end - contentOffsetTop))
          : 0;

        return (
          <div ref={contentRef} className="space-y-2">
            {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
            {visibleArtists.map((artist) => renderOverviewItem(artist, mobileOverviewFields))}
            {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
          </div>
        );
      })()}

      {selectionMode && (
        <>
          {/* Spacer so the floating bar doesn't cover the last rows. */}
          <div aria-hidden className="h-24" />
          <BulkActionBar
            count={selectedCount}
            allSelected={allFilteredSelected}
            onToggleSelectAll={toggleSelectAll}
            onCancel={exit}
            canMonitor={canMonitor}
            canTag={canTag}
            canSearch={canSearch}
            canDelete={canDelete}
            tags={tags}
            onMonitor={handleMonitor}
            onApplyTags={handleApplyTags}
            onSearch={handleBulkSearch}
            onDelete={handleDelete}
            itemNoun="artist"
          />
        </>
      )}
    </div>
  );
}
