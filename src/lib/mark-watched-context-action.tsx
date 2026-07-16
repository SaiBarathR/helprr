import { Check, RotateCcw } from 'lucide-react';
import type { ContextAction } from '@/components/ui/quick-context-menu';
import { isFullyWatched, type WatchStatus } from '@/types/watch-status';
import type { SetWatchedArgs } from '@/components/jellyfin/watch-status-provider';

export interface MarkWatchedContextInput {
  status: WatchStatus | undefined;
  canWrite: boolean;
  isWriting: boolean;
  setWatched: (args: SetWatchedArgs) => void;
}

/** Builds a context-menu action for Jellyfin watched toggle, or null when unavailable. */
export function buildMarkWatchedContextAction({
  status,
  canWrite,
  isWriting,
  setWatched,
}: MarkWatchedContextInput): ContextAction | null {
  if (!canWrite || !status) return null;

  const watched = isFullyWatched(status);
  const seriesId = status.kind === 'series' ? status.jellyfinItemId : undefined;

  return {
    id: 'watched',
    label: watched ? 'Mark as unwatched' : 'Mark as watched',
    icon: watched ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />,
    onSelect: () => {
      setWatched({ jellyfinItemId: status.jellyfinItemId, played: !watched, seriesId });
    },
    disabled: isWriting,
  };
}
