'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import Link from '@/components/ui/app-link';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface FocusItem {
  id: string;
  title: string;
  year: number | null;
  href: string | null;
}

/**
 * The "Now in your library" push opens /watchlist?focus=<itemId>. iOS shows no
 * notification buttons, so this is where an iPhone gets the same choices the
 * Android/desktop push offers: open the title, or take it off the watchlist.
 * `items` is null until a fresh list has loaded; one-shot per focus id.
 */
export function WatchlistFocusDialog<T extends FocusItem>({
  items,
  canEdit,
  removing,
  onRemove,
}: {
  items: T[] | null;
  canEdit: boolean;
  removing: boolean;
  onRemove: (item: T) => Promise<void>;
}) {
  const focusId = useSearchParams().get('focus');
  const [handledFocusId, setHandledFocusId] = useState<string | null>(null);
  const [target, setTarget] = useState<T | null>(null);

  if (focusId && handledFocusId !== focusId && items) {
    setHandledFocusId(focusId);
    const match = items.find((i) => i.id === focusId);
    if (match) setTarget(match);
  }

  // Drop a handled focus from the URL so a reload or Back doesn't open it again.
  useEffect(() => {
    if (!handledFocusId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('focus') !== handledFocusId) return;
    params.delete('focus');
    const query = params.toString();
    window.history.replaceState(null, '', query ? `/watchlist?${query}` : '/watchlist');
  }, [handledFocusId]);

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !removing) setTarget(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Now in your library</DialogTitle>
          <DialogDescription>
            {target ? `${target.title}${target.year ? ` (${target.year})` : ''} from your watchlist is ready to watch.` : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {target && canEdit && (
            <Button
              variant="outline"
              disabled={removing}
              onClick={async () => {
                await onRemove(target);
                setTarget(null);
              }}
            >
              {removing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove from watchlist
            </Button>
          )}
          {target?.href && (
            <Button asChild>
              <Link href={target.href}>Open</Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
