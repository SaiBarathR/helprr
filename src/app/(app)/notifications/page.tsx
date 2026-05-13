'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format, subDays } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Download,
  X,
  AlertTriangle,
  Clock,
  Settings2,
  Loader2,
  Trash2,
  Play,
  Search,
  SlidersHorizontal,
  Calendar as CalendarIcon,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useUIStore } from '@/lib/store';
import { EVENT_GROUPS, EVENT_META, type NotificationEventType } from '@/lib/notification-events';
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

const ICON_MAP = {
  Download, Check, X, AlertTriangle, Clock, Trash2, Play, Bell,
} as const;

function eventIcon(type: string) {
  const meta = EVENT_META[type as NotificationEventType];
  const Icon = meta ? ICON_MAP[meta.iconName] : Bell;
  return <Icon className="h-4 w-4" />;
}

function eventColor(type: string) {
  const meta = EVENT_META[type as NotificationEventType];
  return meta?.colorClass ?? 'bg-muted text-muted-foreground';
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
}): string | null {
  const movieId = toNumber(args.movieId);
  if (movieId) return `/movies/${movieId}`;

  const seriesId = toNumber(args.seriesId);
  const seasonNumber = toNumber(args.seasonNumber);
  const episodeId = toNumber(args.episodeId);
  if (seriesId && seasonNumber && episodeId) {
    return `/series/${seriesId}/season/${seasonNumber}/episode/${episodeId}`;
  }
  if (seriesId && seasonNumber) {
    return `/series/${seriesId}/season/${seasonNumber}`;
  }
  if (seriesId) {
    return `/series/${seriesId}`;
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
  const router = useRouter();

  const filters = useUIStore((s) => s.notificationsFilters);
  const setSearch = useUIStore((s) => s.setNotificationsSearch);
  const setEventTypes = useUIStore((s) => s.setNotificationsEventTypes);
  const setReadState = useUIStore((s) => s.setNotificationsReadState);
  const setDateRange = useUIStore((s) => s.setNotificationsDateRange);
  const resetFilters = useUIStore((s) => s.resetNotificationsFilters);
  const hasHydrated = useUIStore((s) => s.hasHydrated);

  const [searchInput, setSearchInput] = useState(filters.search);
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
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

  const fetchNotifications = useCallback(async (p: number, append: boolean) => {
    if (!append) setLoading(true);
    try {
      const res = await fetch(`/api/notifications?${buildParams(p).toString()}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications((prev) => append ? [...prev, ...(data.records || [])] : (data.records || []));
        setTotal(data.totalRecords ?? 0);
      }
    } catch { } finally {
      setLoading(false);
    }
  }, [buildParams]);

  // Refetch whenever filters change
  useEffect(() => {
    if (!hasHydrated) return;
    setPage(1);
    fetchNotifications(1, false);
  }, [hasHydrated, debouncedSearch, filters.eventTypes, filters.readState, filters.dateFrom, filters.dateTo, fetchNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}`, { method: 'PUT' });
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    } catch { }
  }, []);

  const resolveQueueNotificationHref = useCallback(async (source: 'sonarr' | 'radarr', id: number) => {
    const cacheKey = `${source}:${id}`;
    const cachedQueueItem = queueItemsByKeyRef.current.get(cacheKey);
    if (cachedQueueItem) {
      return getMediaHrefFromIds({
        movieId: cachedQueueItem.movieId,
        seriesId: cachedQueueItem.seriesId,
        seasonNumber: cachedQueueItem.seasonNumber ?? cachedQueueItem.episode?.seasonNumber,
        episodeId: cachedQueueItem.episodeId ?? cachedQueueItem.episode?.id,
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

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
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
      setPage(1);
      await fetchNotifications(1, false);
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
              href="/notifications/preferences"
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
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
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
              <button
                key={n.id}
                onClick={() => void handleNotificationClick(n)}
                className={`w-full text-left flex items-start gap-3 py-3 transition-colors active:bg-muted/50 ${!n.read ? 'border-l-2 border-l-primary bg-primary/5' : ''
                  }`}
              >
                <div className={`p-1.5 rounded-lg mt-0.5 ${eventColor(n.eventType)}`}>
                  {eventIcon(n.eventType)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${!n.read ? 'font-semibold' : ''} truncate`}>{n.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{n.body}</p>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                </span>
              </button>
            ))}
          </div>
          {notifications.length < total && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => { const next = page + 1; setPage(next); fetchNotifications(next, true); }}
            >
              Load more
            </Button>
          )}
        </>
      )}

      {/* Filter drawer */}
      <Drawer open={filterDrawerOpen} onOpenChange={setFilterDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Filter notifications</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-2 space-y-5 overflow-y-auto max-h-[70vh]">
            {/* Event types */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Event types</p>
              {EVENT_GROUPS.map((group) => (
                <div key={group.id} className="space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">{group.title}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.types.map((type) => {
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
              ))}
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
