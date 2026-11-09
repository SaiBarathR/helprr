'use client';

import { Check, RotateCcw } from 'lucide-react';
import { ResponsiveMenuActionItem } from '@/components/ui/responsive-menu';
import { useWatchStatus } from './watch-status-provider';
import { isFullyWatched, type WatchStatus } from '@/types/watch-status';

/**
 * Menu item (dropdown or phone sheet) that toggles a movie/series watched state in Jellyfin. Renders
 * nothing without write capability or when the item isn't matched in Jellyfin
 * (no `status` → no resolved jellyfinItemId to act on). For a series it passes
 * the series id so that series' episode cache is invalidated after the cascade.
 */
export function MarkWatchedMenuItem({ status }: { status: WatchStatus | undefined }) {
  const { canWrite, setWatched, isWriting } = useWatchStatus();
  if (!canWrite || !status) return null;

  const watched = isFullyWatched(status);
  const seriesId = status.kind === 'series' ? status.jellyfinItemId : undefined;

  return (
    <ResponsiveMenuActionItem
      disabled={isWriting}
      onSelect={() => setWatched({ jellyfinItemId: status.jellyfinItemId, played: !watched, seriesId })}
    >
      {watched ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
      {watched ? 'Mark as unwatched' : 'Mark as watched'}
    </ResponsiveMenuActionItem>
  );
}
