'use client';

import { Activity, LogIn, Wifi, ShieldAlert, type LucideIcon } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { timeAgo, formatDateTime } from '@/lib/jellyfin-helpers';
import type { JellyfinActivityEntry } from '@/types/jellyfin';

interface ActivityVisual {
  Icon: LucideIcon;
  /** Tailwind text color class for the icon. */
  color: string;
  /** Tailwind background class for the icon chip. */
  bg: string;
}

export function activityVisual(entry: JellyfinActivityEntry): ActivityVisual {
  const severity = (entry.Severity || '').toLowerCase();
  if (severity === 'error' || severity === 'critical' || severity === 'warning') {
    return { Icon: ShieldAlert, color: 'text-red-500', bg: 'bg-red-500/10' };
  }
  const type = (entry.Type || '').toLowerCase();
  if (type.includes('authentication')) return { Icon: LogIn, color: 'text-green-500', bg: 'bg-green-500/10' };
  if (type.includes('session')) return { Icon: Wifi, color: 'text-[var(--hpr-cyan)]', bg: 'bg-[var(--hpr-cyan)]/10' };
  return { Icon: Activity, color: 'text-muted-foreground', bg: 'bg-muted/50' };
}

interface ActivityItemProps {
  entry: JellyfinActivityEntry;
  variant: 'card' | 'row';
  /** Force the alert (red) treatment regardless of severity. */
  alert?: boolean;
}

export function ActivityItem({ entry, variant, alert = false }: ActivityItemProps) {
  const v = activityVisual(entry);
  const Icon = alert ? ShieldAlert : v.Icon;
  const color = alert ? 'text-red-500' : v.color;
  const bg = alert ? 'bg-red-500/10' : v.bg;

  if (variant === 'card') {
    return (
      <div className="snap-start shrink-0 w-[220px] min-h-[104px] rounded-xl bg-card p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className={`rounded-lg p-1.5 ${bg} ${color}`}><Icon className="h-3.5 w-3.5" /></div>
          <span className="text-[11px] text-muted-foreground shrink-0">{timeAgo(entry.Date)}</span>
        </div>
        <p className="text-sm font-medium leading-snug line-clamp-2">{entry.Name}</p>
        {entry.Overview && (
          <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 mt-auto">{entry.Overview}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 p-3">
      <div className={`rounded-lg p-1.5 ${bg} ${color}`}><Icon className="h-3.5 w-3.5" /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{entry.Name}</p>
        {entry.Overview && <p className="text-xs text-muted-foreground truncate">{entry.Overview}</p>}
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(entry.Date)}</span>
    </div>
  );
}

interface ActivitySeeAllDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  entries: JellyfinActivityEntry[];
  alert?: boolean;
}

export function ActivitySeeAllDrawer({ open, onOpenChange, title, entries, alert = false }: ActivitySeeAllDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-sm">{title} ({entries.length})</DrawerTitle>
        </DrawerHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 space-y-2">
          {entries.map((entry) => {
            const v = activityVisual(entry);
            const Icon = alert ? ShieldAlert : v.Icon;
            const color = alert ? 'text-red-500' : v.color;
            const bg = alert ? 'bg-red-500/10' : v.bg;
            return (
              <div key={entry.Id} className="rounded-xl bg-muted/40 p-3 flex items-start gap-3">
                <div className={`rounded-lg p-1.5 shrink-0 ${bg} ${color}`}><Icon className="h-3.5 w-3.5" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{entry.Name}</p>
                    {entry.Type && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground border-border">{entry.Type}</Badge>
                    )}
                    {entry.Severity && entry.Severity.toLowerCase() !== 'information' && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-red-500 border-red-500/30">{entry.Severity}</Badge>
                    )}
                  </div>
                  {entry.Overview && <p className="text-xs text-muted-foreground mt-1 break-words">{entry.Overview}</p>}
                  <p className="text-[10px] text-muted-foreground/70 mt-1">{formatDateTime(entry.Date)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
