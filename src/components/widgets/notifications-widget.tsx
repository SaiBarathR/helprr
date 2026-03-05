'use client';

import { useCallback } from 'react';
import { Bell } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatDistanceToNowSafe } from '@/lib/format';
import { SectionHeader } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';

interface NotificationRecord {
  id: string;
  eventType: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

async function fetchNotifications(pageSize: number): Promise<NotificationRecord[]> {
  const res = await fetch(`/api/notifications?pageSize=${pageSize}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.records || [];
}

export function NotificationsWidget({ size, refreshInterval }: WidgetProps) {
  const isLarge = size === 'large';
  const maxItems = isLarge ? 10 : 5;
  const fetchFn = useCallback(() => fetchNotifications(maxItems), [maxItems]);
  const { data: notifications, loading } = useWidgetData({ fetchFn, refreshInterval });

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

  if (!notifications || notifications.length === 0) {
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
        {notifications.slice(0, maxItems).map((n) => (
          <div
            key={n.id}
            className={`rounded-xl bg-card px-3 ${isLarge ? 'py-3' : 'py-2.5'} ${!n.read ? 'border-l-2 border-l-primary' : ''}`}
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
