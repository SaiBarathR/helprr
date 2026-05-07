'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Bell, Check, Download, X, AlertTriangle, Clock, Settings2, Loader2, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
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

function eventIcon(type: string) {
  switch (type) {
    case 'grabbed': return <Download className="h-4 w-4" />;
    case 'imported': return <Check className="h-4 w-4" />;
    case 'downloadFailed': case 'importFailed': return <X className="h-4 w-4" />;
    case 'healthWarning': return <AlertTriangle className="h-4 w-4" />;
    case 'upcomingPremiere': return <Clock className="h-4 w-4" />;
    case 'torrentAdded': return <Download className="h-4 w-4" />;
    case 'torrentCompleted': return <Check className="h-4 w-4" />;
    case 'torrentDeleted': return <Trash2 className="h-4 w-4" />;
    default: return <Bell className="h-4 w-4" />;
  }
}

function eventColor(type: string) {
  switch (type) {
    case 'grabbed': return 'bg-blue-500/10 text-blue-500';
    case 'imported': return 'bg-green-500/10 text-green-500';
    case 'downloadFailed': case 'importFailed': return 'bg-red-500/10 text-red-500';
    case 'healthWarning': return 'bg-orange-500/10 text-orange-500';
    case 'upcomingPremiere': return 'bg-purple-500/10 text-purple-500';
    case 'torrentAdded': return 'bg-cyan-500/10 text-cyan-500';
    case 'torrentCompleted': return 'bg-emerald-500/10 text-emerald-500';
    case 'torrentDeleted': return 'bg-zinc-500/10 text-zinc-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

/**
 * Renders the History (notifications) page and manages loading, pagination, and read state for notifications.
 *
 * The component fetches notifications on mount, displays loading and empty states, supports loading additional
 * pages, allows marking individual notifications as read, and provides a control to mark all notifications as read.
 *
 * @returns The Notifications (History) page JSX element
 */
export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  const queueItemsByKeyRef = useRef<Map<string, QueueItem & { source?: string }>>(new Map());
  const queueCacheLoadedRef = useRef(false);
  const historyItemsByKeyRef = useRef<Map<string, HistoryItem>>(new Map());
  const historyCacheLoadedBySourceRef = useRef<Set<'sonarr' | 'radarr'>>(new Set());
  const resolvedHrefByNotificationRef = useRef<Map<string, string>>(new Map());
  const resolvingHrefPromisesRef = useRef<Map<string, Promise<string>>>(new Map());

  async function fetchNotifications(p: number) {
    try {
      const res = await fetch(`/api/notifications?page=${p}&pageSize=30`);
      if (res.ok) {
        const data = await res.json();
        if (p === 1) setNotifications(data.records);
        else setNotifications((prev) => [...prev, ...data.records]);
        setTotal(data.totalRecords);
      }
    } catch { } finally { setLoading(false); }
  }

  useEffect(() => { fetchNotifications(1); }, []);

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

  return (
    <div className="space-y-4 animate-content-in">
      <PageHeader
        showBack={false}
        title="History"
        rightContent={
          <div className="flex items-center gap-1">
            <Link
              href="/notifications/preferences"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
            >
              <Settings2 className="h-5 w-5" />
            </Link>
            <button
              onClick={markAllRead}
              disabled={markingAll}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
            >
              {markingAll ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            </button>
          </div>
        }
      />

      {loading ? (
        <PageSpinner />
      ) : notifications.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No notifications yet</p>
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
            <Button variant="ghost" className="w-full" onClick={() => { const next = page + 1; setPage(next); fetchNotifications(next); }}>
              Load more
            </Button>
          )}
        </>
      )}
    </div>
  );
}
