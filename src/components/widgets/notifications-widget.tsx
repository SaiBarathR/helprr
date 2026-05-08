'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatDistanceToNowSafe } from '@/lib/format';
import { SectionHeader } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';
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
}

interface NotificationRecord {
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

async function fetchNotifications(pageSize: number): Promise<NotificationRecord[]> {
  const res = await fetch(`/api/notifications?pageSize=${pageSize}`);
  if (!res.ok) {
    let details = res.statusText || 'Unknown error';
    try {
      const body = await res.text();
      if (body) details = `${details} - ${body}`;
    } catch {
      // Ignore body read failures; status info is enough.
    }
    throw new Error(`Failed to fetch notifications (${res.status}): ${details}`);
  }
  const data = await res.json();
  return data.records || [];
}

export function NotificationsWidget({ size, refreshInterval }: WidgetProps) {
  const router = useRouter();
  const isLarge = size === 'large';
  const maxItems = isLarge ? 10 : 5;
  const fetchFn = useCallback(() => fetchNotifications(maxItems), [maxItems]);
  const { data: notifications, loading } = useWidgetData({ fetchFn, refreshInterval });
  const [items, setItems] = useState<NotificationRecord[]>([]);

  const queueItemsByKeyRef = useRef<Map<string, QueueItem & { source?: string }>>(new Map());
  const queueCacheLoadedRef = useRef(false);
  const historyItemsByKeyRef = useRef<Map<string, HistoryItem>>(new Map());
  const historyCacheLoadedBySourceRef = useRef<Set<'sonarr' | 'radarr'>>(new Set());
  const resolvedHrefByNotificationRef = useRef<Map<string, string>>(new Map());
  const resolvingHrefPromisesRef = useRef<Map<string, Promise<string>>>(new Map());

  useEffect(() => {
    setItems(notifications ?? []);
  }, [notifications]);

  const markAsRead = useCallback(async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}`, { method: 'PUT' });
      setItems((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
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

  const resolveNotificationHref = useCallback(async (notification: NotificationRecord) => {
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

  const handleNotificationClick = useCallback(async (notification: NotificationRecord) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    const href = await resolveNotificationHref(notification);
    router.push(href);
  }, [markAsRead, resolveNotificationHref, router]);

  if (loading) {
    return (
      <div>
        <SectionHeader title="Notifications" href="/notifications" />
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        <SectionHeader title="Notifications" href="/notifications" />
        <div className="rounded-xl bg-card py-6 text-center">
          <Bell className="h-5 w-5 text-muted-foreground/30 mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">No recent notifications</p>
        </div>
      </div>
    );
  }

  return (
    <div>
        <SectionHeader title="Notifications" href="/notifications" />
        <div className="space-y-1.5">
        {items.slice(0, maxItems).map((n) => (
          <div
            key={n.id}
            onClick={() => void handleNotificationClick(n)}
            className={`w-full text-left cursor-pointer rounded-xl bg-card px-3 ${isLarge ? 'py-3' : 'py-2.5'} ${!n.read ? 'border-l-2 border-l-primary' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className={`text-xs font-medium flex-1 ${isLarge ? 'line-clamp-2' : 'line-clamp-1'}`}>{n.title}</p>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {formatDistanceToNowSafe(n.createdAt)}
              </span>
            </div>
            {n.body && (
              <p className={`text-[11px] text-muted-foreground mt-0.5 ${isLarge ? 'line-clamp-2' : 'line-clamp-1'}`}>
                {n.body}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
