'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format, subDays } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/media/search-input';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Bell,
  Check,
  X,
  Settings2,
  Loader2,
  Trash2,
  Info,
  Search,
  SlidersHorizontal,
  Calendar as CalendarIcon,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { useUIStore } from '@/lib/store';
import { EVENT_GROUPS, EVENT_META, type NotificationEventType } from '@/lib/notification-events';
import { EventIcon, getEventColorClass } from '@/components/notifications/event-visuals';
import { NotificationDetailDrawer } from '@/components/notifications/notification-detail-drawer';
import { EVENT_TYPE_TO_CAPABILITY } from '@/lib/capabilities';
import { useMe, hasCapability } from '@/components/permission-provider';
import { useBadgeActions } from '@/components/layout/badge-provider';
import type { HistoryItem, QueueItem } from '@/types';

type NotificationSource = 'sonarr' | 'radarr' | 'qbittorrent' | 'jellyfin';

interface NotificationMetadata {
  source?: NotificationSource;
  id?: number;
  movieId?: number;
  seriesId?: number;
  seasonNumber?: number;
  episodeId?: number;
  redirect?: string;
  hash?: string;
  sessionId?: string;
  sentCount?: number;
}

interface Notification {
  id: string;
  eventType: string;
  title: string;
  body: string;
  metadata?: NotificationMetadata | null;
  read: boolean;
  createdAt: string;
}

type NotificationsPage = { records: Notification[]; totalRecords: number };

// Apply an updater to every record across all loaded pages of the infinite list.
function mapNotifications(
  data: InfiniteData<NotificationsPage> | undefined,
  fn: (n: Notification) => Notification,
): InfiniteData<NotificationsPage> | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((pg) => ({ ...pg, records: pg.records.map(fn) })) };
}

// Drop a record from every loaded page and decrement the (per-page) totalRecords.
// Used when a row no longer matches the active filter (e.g. marked read under the
// unread view) so it doesn't linger until the next refetch.
function removeNotification(
  data: InfiniteData<NotificationsPage> | undefined,
  id: string,
): InfiniteData<NotificationsPage> | undefined {
  if (!data) return data;
  let removed = 0;
  const pages = data.pages.map((pg) => {
    const records = pg.records.filter((n) => n.id !== id);
    removed += pg.records.length - records.length;
    return { ...pg, records };
  });
  if (removed === 0) return data;
  return { ...data, pages: pages.map((pg) => ({ ...pg, totalRecords: Math.max(0, (pg.totalRecords ?? 0) - removed) })) };
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getMediaHrefFromIds(args: {
  seriesId?: unknown;
  seasonNumber?: unknown;
  episodeId?: unknown;
  movieId?: unknown;
  instanceId?: unknown;
}): string | null {
  const q = typeof args.instanceId === 'string' && args.instanceId ? `?instance=${args.instanceId}` : '';
  const movieId = toNumber(args.movieId);
  if (movieId) return `/movies/${movieId}${q}`;

  const seriesId = toNumber(args.seriesId);
  const seasonNumber = toNumber(args.seasonNumber);
  const episodeId = toNumber(args.episodeId);
  if (seriesId && seasonNumber && episodeId) {
    return `/series/${seriesId}/season/${seasonNumber}/episode/${episodeId}${q}`;
  }
  if (seriesId && seasonNumber) {
    return `/series/${seriesId}/season/${seasonNumber}${q}`;
  }
  if (seriesId) {
    return `/series/${seriesId}${q}`;
  }
  return null;
}

function toIsoDate(value: Date): string {
  return format(value, 'yyyy-MM-dd');
}

function parseIsoDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const QUICK_RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '3m', days: 90 },
];

type DeleteMode = 'all' | 'filtered';

export default function NotificationsPage() {
  const me = useMe();
  const router = useRouter();
  const { adjustBadge, setBadge, refreshBadges } = useBadgeActions();

  const filters = useUIStore((s) => s.notificationsFilters);
  const setSearch = useUIStore((s) => s.setNotificationsSearch);
  const setEventTypes = useUIStore((s) => s.setNotificationsEventTypes);
  const setReadState = useUIStore((s) => s.setNotificationsReadState);
  const setDateRange = useUIStore((s) => s.setNotificationsDateRange);
  const resetFilters = useUIStore((s) => s.resetNotificationsFilters);
  const hasHydrated = useUIStore((s) => s.hasHydrated);

  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState(filters.search);
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  const [markingAll, setMarkingAll] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [detailNotification, setDetailNotification] = useState<Notification | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const queueItemsByKeyRef = useRef<Map<string, QueueItem & { source?: string }>>(new Map());
  const queueCacheLoadedRef = useRef(false);
  const historyItemsByKeyRef = useRef<Map<string, HistoryItem>>(new Map());
  const historyCacheLoadedBySourceRef = useRef<Set<'sonarr' | 'radarr'>>(new Set());
  const resolvedHrefByNotificationRef = useRef<Map<string, string>>(new Map());
  const resolvingHrefPromisesRef = useRef<Map<string, Promise<string>>>(new Map());

  // Sync local search input with persisted store on hydration
  useEffect(() => {
    if (hasHydrated) {
      setSearchInput(filters.search);
      setDebouncedSearch(filters.search);
    }
  }, [hasHydrated, filters.search]);

  // Debounce search input → persisted store
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setSearch(searchInput);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, setSearch]);

  const buildParams = useCallback((p: number) => {
    const params = new URLSearchParams({ page: String(p), pageSize: '30' });
    const q = debouncedSearch.trim();
    if (q) params.set('q', q);
    if (filters.eventTypes.length) params.set('eventType', filters.eventTypes.join(','));
    if (filters.readState !== 'all') {
      params.set('read', filters.readState === 'read' ? 'true' : 'false');
    }
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    return params;
  }, [debouncedSearch, filters.eventTypes, filters.readState, filters.dateFrom, filters.dateTo]);

  // The list query key carries the active filters; changing a filter swaps the
  // key and useInfiniteQuery refetches automatically (replaces the manual effect).
  const listKey = useMemo(
    () =>
      [
        'notifications',
        'list',
        {
          q: debouncedSearch.trim(),
          eventTypes: filters.eventTypes,
          readState: filters.readState,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        },
      ] as const,
    [debouncedSearch, filters.eventTypes, filters.readState, filters.dateFrom, filters.dateTo],
  );

  const notificationsQuery = useInfiniteQuery({
    queryKey: listKey,
    queryFn: async ({ pageParam, signal }) => {
      const res = await fetch(`/api/notifications?${buildParams(pageParam).toString()}`, { signal });
      if (!res.ok) throw new ApiError(res.status, `GET /api/notifications → ${res.status}`);
      return (await res.json()) as NotificationsPage;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, pg) => sum + (pg.records?.length ?? 0), 0);
      return loaded < (lastPage.totalRecords ?? 0) ? allPages.length + 1 : undefined;
    },
    enabled: hasHydrated,
    // Keep the current list on screen while a filter/search change refetches,
    // so the page never blanks to a full-screen spinner.
    placeholderData: keepPreviousData,
  });
  const notifications = useMemo(
    () => notificationsQuery.data?.pages.flatMap((pg) => pg.records ?? []) ?? [],
    [notificationsQuery.data],
  );
  const total = notificationsQuery.data?.pages[0]?.totalRecords ?? 0;
  const loading = !hasHydrated || notificationsQuery.isLoading;

  // Event types present in the user's history — so anything they can see is
  // filterable, even without the matching notify.* receive capability.
  const { data: eventTypesData } = useQuery({
    queryKey: ['notifications', 'event-types'],
    queryFn: jsonFetcher<{ eventTypes?: string[] }>('/api/notifications/event-types'),
    staleTime: 5 * 60_000,
  });
  const availableEventTypes = useMemo(
    () => new Set<string>(Array.isArray(eventTypesData?.eventTypes) ? eventTypesData.eventTypes : []),
    [eventTypesData],
  );

  const markAsRead = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/notifications/${id}`, { method: 'PUT' });
      if (!res.ok) return;
      queryClient.setQueryData<InfiniteData<NotificationsPage>>(listKey, (old) =>
        // Under the unread view the row no longer matches the filter — drop it
        // rather than leaving a now-read row visible until the next refetch.
        filters.readState === 'unread'
          ? removeNotification(old, id)
          : mapNotifications(old, (n) => (n.id === id ? { ...n, read: true } : n)),
      );
      // Callers only invoke this for an unread item, so the nav badge drops by 1.
      adjustBadge('notifications', -1, -1);
    } catch { }
  }, [adjustBadge, queryClient, listKey, filters.readState]);

  const resolveQueueNotificationHref = useCallback(async (source: 'sonarr' | 'radarr', id: number) => {
    const cacheKey = `${source}:${id}`;
    const cachedQueueItem = queueItemsByKeyRef.current.get(cacheKey);
    if (cachedQueueItem) {
      return getMediaHrefFromIds({
        movieId: cachedQueueItem.movieId,
        seriesId: cachedQueueItem.seriesId,
        seasonNumber: cachedQueueItem.seasonNumber ?? cachedQueueItem.episode?.seasonNumber,
        episodeId: cachedQueueItem.episodeId ?? cachedQueueItem.episode?.id,
        instanceId: cachedQueueItem.instanceId,
      });
    }
    if (queueCacheLoadedRef.current) return null;

    try {
      const res = await fetch('/api/activity/queue');
      if (!res.ok) return null;
      const data = await res.json();
      for (const record of (data.records || []) as (QueueItem & { source?: string })[]) {
        if (record.source === 'sonarr' || record.source === 'radarr') {
          queueItemsByKeyRef.current.set(`${record.source}:${record.id}`, record);
        }
      }
      queueCacheLoadedRef.current = true;

      const queueItem = queueItemsByKeyRef.current.get(cacheKey);
      if (!queueItem) return null;
      return getMediaHrefFromIds({
        movieId: queueItem.movieId,
        seriesId: queueItem.seriesId,
        seasonNumber: queueItem.seasonNumber ?? queueItem.episode?.seasonNumber,
        episodeId: queueItem.episodeId ?? queueItem.episode?.id,
        instanceId: queueItem.instanceId,
      });
    } catch {
      return null;
    }
  }, []);

  const resolveHistoryNotificationHref = useCallback(async (source: 'sonarr' | 'radarr', id: number) => {
    const cacheKey = `${source}:${id}`;
    const cachedHistoryItem = historyItemsByKeyRef.current.get(cacheKey);
    if (cachedHistoryItem) {
      return getMediaHrefFromIds({
        movieId: cachedHistoryItem.movieId,
        seriesId: cachedHistoryItem.seriesId,
        seasonNumber: cachedHistoryItem.episode?.seasonNumber,
        episodeId: cachedHistoryItem.episodeId ?? cachedHistoryItem.episode?.id,
        instanceId: cachedHistoryItem.instanceId,
      });
    }
    if (historyCacheLoadedBySourceRef.current.has(source)) return null;

    try {
      const params = new URLSearchParams({
        source,
        eventType: 'imported',
        page: '1',
        pageSize: '500',
      });
      const res = await fetch(`/api/activity/history?${params.toString()}`);
      if (!res.ok) return null;
      const data = await res.json();
      for (const record of (data.records || []) as HistoryItem[]) {
        historyItemsByKeyRef.current.set(`${source}:${record.id}`, record);
      }
      historyCacheLoadedBySourceRef.current.add(source);

      const historyItem = historyItemsByKeyRef.current.get(cacheKey);
      if (!historyItem) return null;
      return getMediaHrefFromIds({
        movieId: historyItem.movieId,
        seriesId: historyItem.seriesId,
        seasonNumber: historyItem.episode?.seasonNumber,
        episodeId: historyItem.episodeId ?? historyItem.episode?.id,
        instanceId: historyItem.instanceId,
      });
    } catch {
      return null;
    }
  }, []);

  const resolveNotificationHref = useCallback(async (notification: Notification) => {
    const cachedHref = resolvedHrefByNotificationRef.current.get(notification.id);
    if (cachedHref) return cachedHref;

    const inFlightHrefPromise = resolvingHrefPromisesRef.current.get(notification.id);
    if (inFlightHrefPromise) return inFlightHrefPromise;

    const resolveHrefPromise = (async () => {
      const metadata = notification.metadata;
      if (typeof metadata?.redirect === 'string' && metadata.redirect.length > 0) {
        return metadata.redirect;
      }

      const directMediaHref = getMediaHrefFromIds({
        movieId: metadata?.movieId,
        seriesId: metadata?.seriesId,
        seasonNumber: metadata?.seasonNumber,
        episodeId: metadata?.episodeId,
      });
      if (directMediaHref) {
        return directMediaHref;
      }

      const source = metadata?.source;
      const metadataId = toNumber(metadata?.id);
      if ((source === 'sonarr' || source === 'radarr') && metadataId) {
        if (notification.eventType === 'imported') {
          const historyHref = await resolveHistoryNotificationHref(source, metadataId);
          if (historyHref) return historyHref;
        }

        const queueHref = await resolveQueueNotificationHref(source, metadataId);
        if (queueHref) return queueHref;

        return `/activity?tab=queue&source=${source}`;
      }

      if (source === 'qbittorrent') return '/torrents';
      if (source === 'jellyfin') return '/jellyfin';

      if (notification.eventType === 'healthWarning') return '/settings';
      if (notification.eventType === 'upcomingPremiere') return '/calendar';
      if (
        notification.eventType === 'grabbed'
        || notification.eventType === 'downloadFailed'
        || notification.eventType === 'importFailed'
      ) {
        return '/activity?tab=queue';
      }
      if (notification.eventType === 'imported') return '/activity/history';
      if (
        notification.eventType === 'torrentAdded'
        || notification.eventType === 'torrentCompleted'
        || notification.eventType === 'torrentDeleted'
      ) {
        return '/torrents';
      }
      return '/activity';
    })();

    resolvingHrefPromisesRef.current.set(notification.id, resolveHrefPromise);

    try {
      const resolvedHref = await resolveHrefPromise;
      resolvedHrefByNotificationRef.current.set(notification.id, resolvedHref);
      return resolvedHref;
    } finally {
      resolvingHrefPromisesRef.current.delete(notification.id);
    }
  }, [resolveHistoryNotificationHref, resolveQueueNotificationHref]);

  const handleNotificationClick = useCallback(async (notification: Notification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    const href = await resolveNotificationHref(notification);
    router.push(href);
  }, [markAsRead, resolveNotificationHref, router]);

  const handleOpenDetail = useCallback((notification: Notification) => {
    if (!notification.read) {
      void markAsRead(notification.id);
      setDetailNotification({ ...notification, read: true });
    } else {
      setDetailNotification(notification);
    }
  }, [markAsRead]);

  async function markAllRead() {
    setMarkingAll(true);
    try {
      const res = await fetch('/api/notifications/read-all', { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      if (filters.readState === 'unread') {
        // Everything just became read — the unread list is now empty; reset it.
        await queryClient.resetQueries({ queryKey: listKey });
      } else {
        queryClient.setQueryData<InfiniteData<NotificationsPage>>(listKey, (old) =>
          mapNotifications(old, (n) => ({ ...n, read: true })),
        );
      }
      setBadge('notifications', { total: 0, attention: 0 });
      toast.success('All marked as read');
    } catch { toast.error('Failed'); }
    finally { setMarkingAll(false); }
  }

  // Filter helpers
  const toggleEventType = useCallback((type: string) => {
    const next = filters.eventTypes.includes(type)
      ? filters.eventTypes.filter((t) => t !== type)
      : [...filters.eventTypes, type];
    setEventTypes(next);
  }, [filters.eventTypes, setEventTypes]);

  const dateRangeForCalendar: DateRange | undefined = useMemo(() => {
    const from = parseIsoDate(filters.dateFrom);
    const to = parseIsoDate(filters.dateTo);
    if (!from && !to) return undefined;
    return { from, to };
  }, [filters.dateFrom, filters.dateTo]);

  const applyQuickRange = useCallback((days: number) => {
    const to = new Date();
    const from = subDays(to, days - 1);
    setDateRange(toIsoDate(from), toIsoDate(to));
  }, [setDateRange]);

  const dateRangeLabel = useMemo(() => {
    if (!filters.dateFrom && !filters.dateTo) return 'Any time';
    const fromStr = filters.dateFrom ? format(parseIsoDate(filters.dateFrom)!, 'MMM d, yyyy') : '…';
    const toStr = filters.dateTo ? format(parseIsoDate(filters.dateTo)!, 'MMM d, yyyy') : 'now';
    return fromStr === toStr ? fromStr : `${fromStr} → ${toStr}`;
  }, [filters.dateFrom, filters.dateTo]);

  const hasActiveFilters =
    debouncedSearch.trim().length > 0
    || filters.eventTypes.length > 0
    || filters.readState !== 'all'
    || filters.dateFrom !== null
    || filters.dateTo !== null;

  // Bulk delete
  const [deleteMode, setDeleteMode] = useState<DeleteMode>('all');

  async function performDelete() {
    setDeleting(true);
    try {
      let url = '/api/notifications';
      if (deleteMode === 'all') {
        url += '?all=true';
      } else {
        const params = new URLSearchParams();
        const q = debouncedSearch.trim();
        if (q) params.set('q', q);
        if (filters.eventTypes.length) params.set('eventType', filters.eventTypes.join(','));
        if (filters.readState !== 'all') {
          params.set('read', filters.readState === 'read' ? 'true' : 'false');
        }
        if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
        if (filters.dateTo) params.set('dateTo', filters.dateTo);
        if ([...params.keys()].length === 0) params.set('all', 'true');
        url += `?${params.toString()}`;
      }
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Delete failed');
      }
      const data = await res.json();
      toast.success(`Deleted ${data.deletedCount} notification${data.deletedCount === 1 ? '' : 's'}`);
      setDeleteDialogOpen(false);
      // Reset the infinite list back to a fresh first page.
      await queryClient.resetQueries({ queryKey: listKey });
      // A delete can remove an unknown number of unread rows; the badge endpoint
      // counts unread live from the DB, so refetch the authoritative number.
      refreshBadges();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3 animate-content-in">
      <PageHeader
        showBack={false}
        title="History"
        rightContent={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFilterDrawerOpen(true)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary relative"
              aria-label="Filter notifications"
            >
              <SlidersHorizontal className="h-5 w-5" />
              {hasActiveFilters && (
                <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
              )}
            </button>
            <Link
              href="/settings/notifications"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
              aria-label="Notification preferences"
            >
              <Settings2 className="h-5 w-5" />
            </Link>
            <button
              onClick={markAllRead}
              disabled={markingAll}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
              aria-label="Mark all as read"
            >
              {markingAll ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            </button>
          </div>
        }
      />

      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          historyKey="notifications"
          placeholder="Search notifications…"
          className="pl-9 pr-9 h-10"
        />
        {searchInput.length > 0 && (
          <button
            type="button"
            onClick={() => setSearchInput('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.eventTypes.map((type) => (
            <Badge key={type} variant="secondary" className="gap-1 pr-1">
              {EVENT_META[type as NotificationEventType]?.label ?? type}
              <button
                type="button"
                onClick={() => toggleEventType(type)}
                className="ml-1 p-0.5 hover:bg-muted-foreground/20 rounded"
                aria-label={`Remove ${type} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {filters.readState !== 'all' && (
            <Badge variant="secondary" className="gap-1 pr-1">
              {filters.readState === 'unread' ? 'Unread' : 'Read'}
              <button
                type="button"
                onClick={() => setReadState('all')}
                className="ml-1 p-0.5 hover:bg-muted-foreground/20 rounded"
                aria-label="Clear read state filter"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {(filters.dateFrom || filters.dateTo) && (
            <Badge variant="secondary" className="gap-1 pr-1">
              {dateRangeLabel}
              <button
                type="button"
                onClick={() => setDateRange(null, null)}
                className="ml-1 p-0.5 hover:bg-muted-foreground/20 rounded"
                aria-label="Clear date filter"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          <button
            type="button"
            onClick={() => { resetFilters(); setSearchInput(''); }}
            className="text-xs text-muted-foreground underline ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      {loading ? (
        <PageSpinner />
      ) : notifications.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>{hasActiveFilters ? 'No notifications match your filters' : 'No notifications yet'}</p>
        </div>
      ) : (
        <>
          <div className="space-y-0.5 animate-list-in">
            {notifications.map((n) => (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={() => void handleNotificationClick(n)}
                onKeyDown={(e) => {
                  if (e.currentTarget === e.target && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    void handleNotificationClick(n);
                  }
                }}
                className={`group w-full text-left flex items-start gap-3 py-3 cursor-pointer transition-colors active:bg-muted/50 ${!n.read ? 'border-l-2 border-l-primary bg-primary/5' : ''
                  }`}
              >
                <div className={`p-1.5 rounded-lg mt-0.5 ${getEventColorClass(n.eventType)}`}>
                  <EventIcon type={n.eventType} className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${!n.read ? 'font-semibold' : ''} truncate`}>{n.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{n.body}</p>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                </span>
                <button
                  type="button"
                  aria-label="View details"
                  onClick={(e) => { e.stopPropagation(); handleOpenDetail(n); }}
                  className="shrink-0 -mr-1 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <Info className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          {notificationsQuery.hasNextPage && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => notificationsQuery.fetchNextPage()}
              disabled={notificationsQuery.isFetchingNextPage}
            >
              {notificationsQuery.isFetchingNextPage ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Load more'
              )}
            </Button>
          )}
        </>
      )}

      {/* Detail drawer */}
      <NotificationDetailDrawer
        notification={detailNotification}
        onClose={() => setDetailNotification(null)}
        canGoTo
        onGoTo={detailNotification
          ? () => {
              const n = detailNotification;
              setDetailNotification(null);
              void handleNotificationClick(n);
            }
          : undefined}
      />

      {/* Filter drawer */}
      <Drawer open={filterDrawerOpen} onOpenChange={setFilterDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Filter notifications</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-2 space-y-5 overflow-y-auto flex-1 min-h-0">
            {/* Event types */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Event types</p>
              {EVENT_GROUPS.map((group) => {
                const visibleTypes = group.types.filter((t) =>
                  hasCapability(me, EVENT_TYPE_TO_CAPABILITY[t]) || availableEventTypes.has(t)
                );
                if (visibleTypes.length === 0) return null;
                return (
                <div key={group.id} className="space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">{group.title}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {visibleTypes.map((type) => {
                      const selected = filters.eventTypes.includes(type);
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => toggleEventType(type)}
                          className={`px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors min-h-[32px] ${selected
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted/40 text-foreground border-transparent hover:bg-muted'
                            }`}
                        >
                          {EVENT_META[type].label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>

            <Separator />

            {/* Read state */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Read state</p>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-md bg-muted/40">
                {(['all', 'unread', 'read'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setReadState(opt)}
                    className={`py-2 rounded text-xs font-medium capitalize transition-colors ${filters.readState === opt
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground'
                      }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Date range */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date range</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_RANGES.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => applyQuickRange(r.days)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDateRange(null, null)}
                  className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                >
                  All time
                </button>
              </div>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left text-xs h-9 font-normal">
                    <CalendarIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    {dateRangeLabel}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={dateRangeForCalendar}
                    onSelect={(range) => {
                      setDateRange(
                        range?.from ? toIsoDate(range.from) : null,
                        range?.to ? toIsoDate(range.to) : null,
                      );
                      if (range?.to) setCalendarOpen(false);
                    }}
                    disabled={{ after: new Date() }}
                    numberOfMonths={1}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DrawerFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                setFilterDrawerOpen(false);
                setDeleteMode(hasActiveFilters ? 'filtered' : 'all');
                setDeleteDialogOpen(true);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete…
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              className="h-11"
              onClick={() => { resetFilters(); setSearchInput(''); }}
            >
              Reset
            </Button>
            <Button className="h-11" onClick={() => setFilterDrawerOpen(false)}>
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Bulk delete confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete notification history</DialogTitle>
            <DialogDescription className="sr-only">
              Choose whether to delete all notifications or only the filtered ones.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-start gap-3 p-3 rounded-md border cursor-pointer hover:bg-muted/30">
              <input
                type="radio"
                name="delete-mode"
                checked={deleteMode === 'all'}
                onChange={() => setDeleteMode('all')}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="text-sm font-medium">All notifications</p>
                <p className="text-xs text-muted-foreground">Permanently delete every notification.</p>
              </div>
            </label>

            <label className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer hover:bg-muted/30 ${!hasActiveFilters ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input
                type="radio"
                name="delete-mode"
                checked={deleteMode === 'filtered'}
                onChange={() => setDeleteMode('filtered')}
                disabled={!hasActiveFilters}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="text-sm font-medium">Notifications matching current filters</p>
                <p className="text-xs text-muted-foreground">
                  {hasActiveFilters
                    ? `Will delete the ${total} notification${total === 1 ? '' : 's'} currently matched. Use the date-range filter to delete by date.`
                    : 'Set filters first (event type, date range, etc.) to delete a subset.'}
                </p>
              </div>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="h-11"
              onClick={performDelete}
              disabled={deleting || (deleteMode === 'filtered' && !hasActiveFilters)}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
