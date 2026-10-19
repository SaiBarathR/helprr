'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Film,
  Tv,
  MonitorPlay,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import type { CustomHistoryItem } from '@/types/jellyfin';
import { formatDurationSeconds } from '@/lib/jellyfin-helpers';

// ─── Helpers ───

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

function formatDateCreated(dateStr: string): string {
  // DateCreated is UTC e.g. "2026-02-20 19:11:07.0338097"
  try {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date)
  } catch (error) {
    console.error("Failed to parse date:", error);
    return dateStr;
  }
}

export const MAX_DAYS = 18250;

// ─── Shared UI ───

export function Carousel({ children, className = '', restorationKey }: { children: React.ReactNode; className?: string; restorationKey: string }) {
  return (
    <div className="relative">
      <div data-scroll-restoration-key={`jellyfin:${restorationKey}`} className={`flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide -mx-1 px-1 scroll-px-1 ${className}`}>
        {children}
      </div>
      <div className="pointer-events-none absolute top-0 right-0 bottom-2 w-8 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}

export function SectionHeader({ title, badge, trailing }: { title: string; badge?: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {badge}
      </div>
      {trailing}
    </div>
  );
}

export function PluginNotice() {
  return (
    <div className="rounded-xl bg-muted/30 p-6 text-center">
      <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">Playback Reporting Plugin not detected</p>
      <p className="text-xs text-muted-foreground/70 mt-1">Install the Jellyfin Playback Reporting Plugin for watch history and statistics.</p>
    </div>
  );
}

// Shown when the Jellyfin server itself can't be reached — distinct from the
// per-section empty states, which would otherwise render a blank/misleading
// page ("No user activity found") on a connection failure.
export function ServerErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl bg-muted/30 p-6 text-center">
      <AlertCircle className="h-8 w-8 mx-auto mb-2 text-destructive/60" />
      <p className="text-sm font-medium text-muted-foreground">Couldn&apos;t reach the Jellyfin server</p>
      <p className="text-xs text-muted-foreground/70 mt-1">Check that Jellyfin is running and its connection settings are correct.</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
        Retry
      </Button>
    </div>
  );
}

// ─── History Row (for CustomHistoryItem from submit_custom_query) ───

function getMethodInfo(method: string): { label: string; colorClass: string } {
  const m = method.toLowerCase();
  if (m.startsWith('directplay')) return { label: method, colorClass: 'text-green-500 border-green-500/30' };
  if (m.startsWith('directstream')) return { label: method, colorClass: 'text-blue-500 border-blue-500/30' };
  if (m.startsWith('transcode')) return { label: method, colorClass: 'text-orange-500 border-orange-500/30' };
  return { label: method, colorClass: '' };
}

export function CustomHistoryRow({ item }: { item: CustomHistoryItem }) {
  const { label: methodLabel, colorClass: methodColor } = getMethodInfo(item.PlaybackMethod);

  return (
    <div className="flex items-center gap-3 py-1 px-0 rounded-lg hover:bg-muted/30">
      <div className="p-1.5 rounded bg-muted shrink-0">
        {item.ItemType === 'Movie' ? <Film className="h-3.5 w-3.5 text-muted-foreground" /> :
          item.ItemType === 'Episode' ? <Tv className="h-3.5 w-3.5 text-muted-foreground" /> :
            <MonitorPlay className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{item.ItemName}</p>
        {/* Long client or device names truncate; the play time always shows. */}
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="min-w-0 truncate">{item.ClientName}</span><span className="shrink-0">&middot;</span><span className="min-w-0 truncate">{item.DeviceName}</span><span className="shrink-0">&middot;</span><span className="shrink-0">{formatDurationSeconds(item.PlayDuration)}</span>
        </div>
      </div>
      <div className="text-right shrink-0 space-y-0.5">
        {/* Transcode labels run long ("Transcode (v:h264 a:direct)"); cap them so
            the title keeps its room on phones. */}
        <Badge variant="outline" className={`max-w-[8rem] text-[9px] px-1 py-0 ${methodColor}`} title={methodLabel}>
          <span className="truncate">{methodLabel}</span>
        </Badge>
        <p className="text-[10px] text-muted-foreground">{formatDateCreated(item.DateCreated)}</p>
      </div>
    </div>
  );
}
