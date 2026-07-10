'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Info } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { formatDistanceToNowSafe } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';
import { EventIcon, getEventHprColor } from '@/components/notifications/event-visuals';
import { NotificationDetailDrawer } from '@/components/notifications/notification-detail-drawer';
import { useBadgeActions } from '@/components/layout/badge-provider';
import { FONT_MONO, HPR, SectionHeader, mix } from './bento-primitives';

// Notification cards include 2 lines of body text + padding, so they're
// taller than the dashboard's generic LIST_ROW_HEIGHT.
const NOTIFICATION_ROW_HEIGHT = 64;

interface NotificationRecord {
  id: string;
  eventType: string;
  title: string;
  body: string;
  metadata?: { source?: string; redirect?: string } | null;
  read: boolean;
  createdAt: string;
}

async function fetchNotifications(pageSize: number): Promise<NotificationRecord[]> {
  const res = await fetch(`/api/notifications?pageSize=${pageSize}`);
  if (!res.ok) throw new Error(`Failed (${res.status})`);
  const data = await res.json();
  return data.records || [];
}

export function NotificationsWidget({
  refreshInterval,
  editMode = false,
}: WidgetProps) {
  const router = useRouter();
  const { adjustBadge } = useBadgeActions();
  const { ref, height } = useElementSize<HTMLDivElement>();
  const { visibleCount: maxItems, fetchSize: fetchPageSize } = useListFetchSize({
    height,
    rowHeight: NOTIFICATION_ROW_HEIGHT,
    bucketSize: 5,
  });
  const fetchFn = useCallback(() => fetchNotifications(fetchPageSize), [fetchPageSize]);
  const { data, loading } = useWidgetData({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `notifications-${fetchPageSize}`,
  });
  const [locallyRead, setLocallyRead] = useState<Set<string>>(() => new Set());
  const [detail, setDetail] = useState<NotificationRecord | null>(null);
  const items = useMemo<NotificationRecord[]>(() => {
    const upstream = data ?? [];
    if (locallyRead.size === 0) return upstream;
    return upstream.map((n) => (locallyRead.has(n.id) ? { ...n, read: true } : n));
  }, [data, locallyRead]);

  // Synchronous "count this id exactly once" guard, so a rapid double-tap on the
  // same unread item can't decrement the badge twice (setLocallyRead is async).
  const markedRef = useRef<Set<string>>(new Set());

  const markRead = useCallback(async (n: NotificationRecord) => {
    if (n.read || markedRef.current.has(n.id)) return;
    markedRef.current.add(n.id);
    setLocallyRead((prev) => {
      const next = new Set(prev);
      next.add(n.id);
      return next;
    });
    adjustBadge('notifications', -1, -1);
    try {
      const res = await fetch(`/api/notifications/${n.id}`, { method: 'PUT' });
      if (!res.ok) throw new Error(`PUT failed (${res.status})`);
    } catch {
      markedRef.current.delete(n.id);
      setLocallyRead((prev) => {
        if (!prev.has(n.id)) return prev;
        const next = new Set(prev);
        next.delete(n.id);
        return next;
      });
      adjustBadge('notifications', 1, 1);
    }
  }, [adjustBadge]);

  const handleClick = useCallback(
    (n: NotificationRecord) => {
      if (editMode) return;
      void markRead(n);
      router.push(n.metadata?.redirect ?? '/notifications');
    },
    [router, editMode, markRead],
  );

  const handleOpenDetail = useCallback(
    (n: NotificationRecord) => {
      if (editMode) return;
      void markRead(n);
      setDetail(n.read ? n : { ...n, read: true });
    },
    [editMode, markRead],
  );

  if (loading && items.length === 0) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title="Notifications" />
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title="Notifications" />
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
          No recent notifications
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <SectionHeader
        title="Notifications"
        right={
          <Link href="/notifications" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="@max-[219px]/cell:hidden">View all </span>→
          </Link>
        }
      />
      <div
        className="no-scrollbar scroll-fade-y"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        {items.slice(0, maxItems).map((n) => {
          const color = getEventHprColor(n.eventType);
          const unread = !n.read;
          return (
            <div
              key={n.id}
              onClick={() => void handleClick(n)}
              onKeyDown={(e) => {
                if (editMode) return;
                if (e.currentTarget === e.target && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  void handleClick(n);
                }
              }}
              role={editMode ? undefined : 'button'}
              tabIndex={editMode ? -1 : 0}
              style={{
                display: 'flex',
                gap: 8,
                padding: '8px 10px',
                background: HPR.ink,
                border: `1px solid ${HPR.hairline}`,
                borderLeft: `3px solid ${unread ? HPR.amber : HPR.hairline2}`,
                borderRadius: 6,
                cursor: editMode ? 'default' : 'pointer',
              }}
            >
              <div
                // Icon chip is decoration — dropped on compact cells. display
                // lives in classes so the container variant's `hidden` wins.
                className="flex items-center justify-center @max-[219px]/cell:hidden"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  background: mix(color, 14),
                  color,
                  flexShrink: 0,
                }}
              >
                <EventIcon type={n.eventType} style={{ width: 13, height: 13 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    alignItems: 'baseline',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: HPR.fg,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {n.title}
                  </span>
                  {/* "about 11 hours ago" → "11 hours" on compact cells so it
                      can't crowd out the title or run under the info button. */}
                  <span
                    className="shrink-0 @max-[219px]/cell:hidden"
                    style={{ fontFamily: FONT_MONO, fontSize: 9, color: HPR.fgSubtle }}
                  >
                    {formatDistanceToNowSafe(n.createdAt)}
                  </span>
                  <span
                    className="hidden shrink-0 @max-[219px]/cell:inline"
                    style={{ fontFamily: FONT_MONO, fontSize: 9, color: HPR.fgSubtle }}
                  >
                    {formatDistanceToNowSafe(n.createdAt).replace(/^about /, '').replace(/ ago$/, '')}
                  </span>
                </div>
                {n.body && (
                  <div
                    style={{
                      fontSize: 11,
                      color: HPR.fgMute,
                      marginTop: 2,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      lineHeight: 1.35,
                    }}
                  >
                    {n.body}
                  </div>
                )}
              </div>
              {!editMode && (
                <button
                  type="button"
                  aria-label="View details"
                  onClick={(e) => { e.stopPropagation(); handleOpenDetail(n); }}
                  style={{
                    flexShrink: 0,
                    alignSelf: 'flex-start',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 2,
                    border: 'none',
                    background: 'transparent',
                    color: HPR.fgSubtle,
                    cursor: 'pointer',
                  }}
                >
                  <Info style={{ width: 13, height: 13 }} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <NotificationDetailDrawer
        notification={detail}
        onClose={() => setDetail(null)}
        canGoTo={!!detail?.metadata?.redirect}
        onGoTo={detail
          ? () => {
              const n = detail;
              setDetail(null);
              void handleClick(n);
            }
          : undefined}
      />
    </div>
  );
}
