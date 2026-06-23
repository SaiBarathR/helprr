'use client';

import { Check, RotateCcw } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useWatchStatus } from './watch-status-provider';
import { isFullyWatched, type WatchStatus } from '@/types/watch-status';

/**
 * Dropdown item that toggles a movie/series watched state in Jellyfin. Renders
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
    <DropdownMenuItem
      disabled={isWriting}
      onClick={() => setWatched({ jellyfinItemId: status.jellyfinItemId, played: !watched, seriesId })}
    >
      {watched ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
      {watched ? 'Mark as unwatched' : 'Mark as watched'}
    </DropdownMenuItem>
  );
}
