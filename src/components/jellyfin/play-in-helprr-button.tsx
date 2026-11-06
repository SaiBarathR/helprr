'use client';

import Link from '@/components/ui/app-link';
import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/components/permission-provider';
import { cn } from '@/lib/utils';

/**
 * Resolves a library title to its Jellyfin item id via provider ids.
 *
 * `/api/jellyfin/lookup` is cached per connection, so calling this from every
 * detail page is cheap after the first hit.
 */
function useJellyfinItemId(ids: { imdbId?: string | null; tmdbId?: number | string | null; tvdbId?: number | string | null }) {
  const canView = useCan('jellyfin.view');
  const { imdbId, tmdbId, tvdbId } = ids;
  const params = new URLSearchParams();
  if (imdbId) params.set('imdbId', String(imdbId));
  if (tmdbId) params.set('tmdbId', String(tmdbId));
  if (tvdbId) params.set('tvdbId', String(tvdbId));
  // Empty when no lookup will run.
  const query = canView ? params.toString() : '';
  // Keyed by query, so a stale answer never stands in for new ids.
  const [result, setResult] = useState<{ query: string; itemId: string | null } | null>(null);

  useEffect(() => {
    if (!query) return undefined;
    let cancelled = false;
    void (async () => {
      let itemId: string | null = null;
      try {
        const res = await fetch(`/api/jellyfin/lookup?${query}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.itemId) itemId = data.itemId as string;
        }
      } catch {
        // A title that is not in Jellyfin is the normal case, not an error.
      }
      if (!cancelled) setResult({ query, itemId });
    })();
    return () => { cancelled = true; };
  }, [query]);

  if (!query) return { itemId: null, pending: false };
  if (result?.query !== query) return { itemId: null, pending: true };
  return { itemId: result.itemId, pending: false };
}

const PLACEHOLDER_HEIGHT = { sm: 'h-8', default: 'h-9', lg: 'h-10' } as const;

/**
 * Play a library title inside Helprr's own player.
 *
 * Renders nothing until the lookup confirms the title exists in Jellyfin — a
 * Play button that reports "not found" on click is worse than no button.
 * With `reserveSpace`, a skeleton of the button's size holds its place while
 * the lookup is pending, so the button cannot push down what sits below it.
 * The skeleton takes `className`, so give it the button's width there.
 */
export function PlayInHelprrButton({
  imdbId,
  tmdbId,
  tvdbId,
  size = 'default',
  variant = 'default',
  className,
  autoPlay = true,
  reserveSpace = false,
}: {
  imdbId?: string | null;
  tmdbId?: number | string | null;
  tvdbId?: number | string | null;
  size?: 'sm' | 'default' | 'lg';
  variant?: 'default' | 'secondary' | 'outline';
  className?: string;
  /** Start playback on arrival rather than just opening the title page. */
  autoPlay?: boolean;
  /** Hold the button's space while the lookup is pending. */
  reserveSpace?: boolean;
}) {
  const { itemId, pending } = useJellyfinItemId({ imdbId, tmdbId, tvdbId });
  if (!itemId) {
    if (!pending || !reserveSpace) return null;
    return <Skeleton aria-hidden className={cn(PLACEHOLDER_HEIGHT[size], className)} />;
  }

  return (
    <Button size={size} variant={variant} className={className} asChild>
      <Link href={`/jellyfin/library/item/${itemId}${autoPlay ? '?play=1' : ''}`}>
        <Play className="fill-current" data-icon="inline-start" />
        Play
      </Link>
    </Button>
  );
}
