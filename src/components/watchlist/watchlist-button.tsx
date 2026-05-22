'use client';

import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WatchlistAddDialog, type WatchlistDraft } from './watchlist-add-dialog';

interface Props {
  draft: WatchlistDraft;
  initialTags?: string[];
  variant?: 'button' | 'icon';
  label?: string;
  className?: string;
}

export function WatchlistButton({
  draft,
  initialTags,
  variant = 'button',
  label = 'Watchlist',
  className,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          aria-label="Add to watchlist"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className={
            className ??
            'inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/80 backdrop-blur-sm text-foreground hover:bg-background border border-border/50'
          }
        >
          <Bookmark className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
          className={className}
        >
          <Bookmark className="mr-1.5 h-4 w-4" />
          {label}
        </Button>
      )}
      <WatchlistAddDialog
        open={open}
        onOpenChange={setOpen}
        draft={draft}
        initialTags={initialTags}
      />
    </>
  );
}
