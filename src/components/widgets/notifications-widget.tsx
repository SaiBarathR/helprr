'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { formatDistanceToNowSafe } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';
import { FONT_MONO, HPR, SECTION_HEADER_HEIGHT, SectionHeader, mix } from './bento-primitives';

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

function eventKind(eventType: string): 'torrent' | 'jellyfin' | 'warning' | 'import' | 'default' {
  if (eventType.startsWith('torrent')) return 'torrent';
  if (eventType.startsWith('jellyfin')) return 'jellyfin';
  if (eventType === 'healthWarning' || eventType.endsWith('Failed')) return 'warning';
  if (eventType === 'imported' || eventType === 'grabbed') return 'import';
  return 'default';
}

const KIND_COLORS = {
  torrent: HPR.blue,
  jellyfin: HPR.cyan,
  warning: HPR.amber,
  import: HPR.green,
  default: HPR.fgMute,
} as const;

const KIND_ICONS = {
  torrent: '⛁',
  jellyfin: '▶',
  warning: '⚠',
  import: '✓',
  default: '·',
} as const;

export function NotificationsWidget({
  refreshInterval,
  editMode = false,
}: WidgetProps) {
  const router = useRouter();
  const { ref, height } = useElementSize<HTMLDivElement>();
  const maxItems = useMemo(() => {
    if (height <= 0) return 5;
    return Math.max(3, Math.ceil((height - SECTION_HEADER_HEIGHT) / NOTIFICATION_ROW_HEIGHT) + 3);
  }, [height]);
  const fetchPageSize = Math.ceil(maxItems / 5) * 5;
  const fetchFn = useCallback(() => fetchNotifications(fetchPageSize), [fetchPageSize]);
  const { data, loading } = useWidgetData({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `notifications-${fetchPageSize}`,
  });
  const [locallyRead, setLocallyRead] = useState<Set<string>>(() => new Set());
  const items = useMemo<NotificationRecord[]>(() => {
    const upstream = data ?? [];
    if (locallyRead.size === 0) return upstream;
    return upstream.map((n) => (locallyRead.has(n.id) ? { ...n, read: true } : n));
  }, [data, locallyRead]);

  const handleClick = useCallback(
    async (n: NotificationRecord) => {
      if (editMode) return;
      if (!n.read) {
        setLocallyRead((prev) => {
          if (prev.has(n.id)) return prev;
          const next = new Set(prev);
          next.add(n.id);
          return next;
        });
        try {
          await fetch(`/api/notifications/${n.id}`, { method: 'PUT' });
        } catch {
          // ignore
        }
      }
      const href = n.metadata?.redirect ?? '/notifications';
      router.push(href);
    },
    [router, editMode],
  );

  if (loading && items.length === 0) {
    return (
      <div ref={ref}>
        <SectionHeader title="Notifications" />
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div ref={ref}>
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
      <SectionHeader title="Notifications" right={<span>View all →</span>} />
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
          const kind = eventKind(n.eventType);
          const color = KIND_COLORS[kind];
          const unread = !n.read;
          return (
            <div
              key={n.id}
              onClick={() => void handleClick(n)}
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
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  background: mix(color, 14),
                  color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  flexShrink: 0,
                }}
              >
                {KIND_ICONS[kind]}
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
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 9,
                      color: HPR.fgSubtle,
                      flexShrink: 0,
                    }}
                  >
                    {formatDistanceToNowSafe(n.createdAt)}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
