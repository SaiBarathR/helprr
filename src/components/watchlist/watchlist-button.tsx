'use client';

import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WatchlistAddDialog, type WatchlistDraft } from '@/components/watchlist/watchlist-add-dialog';
import { useWatchlistEntry, WatchlistSavedDialog, type WatchlistMatchQuery } from '@/components/watchlist/watchlist-saved';
import { useCan } from '@/components/permission-provider';
import { cn } from '@/lib/utils';

interface Props {
  draft: WatchlistDraft;
  initialTags?: string[];
  variant?: 'button' | 'icon';
  label?: string;
  className?: string;
  /** The icon's 44px hit area; `height` grows only its height. */
  hitArea?: 'full' | 'height';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The title's ids: once it is on the watchlist the icon shows it saved. */
  match?: WatchlistMatchQuery;
}

export function WatchlistButton({
  draft,
  initialTags,
  variant = 'button',
  label = 'Watchlist',
  className,
  hitArea = 'full',
  open: controlledOpen,
  onOpenChange,
  match,
}: Props) {
  const canEdit = useCan('watchlist.edit');
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const entry = useWatchlistEntry(match ?? null);
  const [savedOpen, setSavedOpen] = useState(false);

  if (!canEdit) return null;

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          aria-label={entry ? 'On your watchlist' : 'Add to watchlist'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (entry) setSavedOpen(true);
            else setOpen(true);
          }}
          className={cn(
            className ??
              'inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/80 backdrop-blur-sm text-foreground hover:bg-background border border-border/50',
            'relative',
            hitArea === 'height' ? 'touch-target-y' : 'touch-target',
          )}
        >
          <Bookmark className={cn('h-3.5 w-3.5', entry && 'fill-current')} />
        </button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.preventDefault();
            if (entry) setSavedOpen(true);
            else setOpen(true);
          }}
          className={className}
        >
          <Bookmark className={cn('mr-1.5 h-4 w-4', entry && 'fill-current')} />
          {label}
        </Button>
      )}
      <WatchlistAddDialog
        open={open}
        onOpenChange={setOpen}
        draft={draft}
        initialTags={initialTags}
      />
      <WatchlistSavedDialog open={savedOpen} onOpenChange={setSavedOpen} entry={entry} />
    </>
  );
}
