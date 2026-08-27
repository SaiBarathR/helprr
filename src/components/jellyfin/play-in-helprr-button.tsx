'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCan } from '@/components/permission-provider';

/**
 * Resolves a library title to its Jellyfin item id via provider ids.
 *
 * `/api/jellyfin/lookup` is cached per connection, so calling this from every
 * detail page is cheap after the first hit.
 */
function useJellyfinItemId(ids: { imdbId?: string | null; tmdbId?: number | string | null; tvdbId?: number | string | null }) {
  const canView = useCan('jellyfin.view');
  const [itemId, setItemId] = useState<string | null>(null);
  const { imdbId, tmdbId, tvdbId } = ids;

  useEffect(() => {
    if (!canView) return undefined;
    const params = new URLSearchParams();
    if (imdbId) params.set('imdbId', String(imdbId));
    if (tmdbId) params.set('tmdbId', String(tmdbId));
    if (tvdbId) params.set('tvdbId', String(tvdbId));
    if (![...params.keys()].length) return undefined;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/jellyfin/lookup?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.itemId) setItemId(data.itemId as string);
      } catch {
        // A title that is not in Jellyfin is the normal case, not an error.
      }
    })();
    return () => { cancelled = true; };
  }, [canView, imdbId, tmdbId, tvdbId]);

  return itemId;
}

/**
 * Play a library title inside Helprr's own player.
 *
 * Renders nothing until the lookup confirms the title exists in Jellyfin — a
 * Play button that reports "not found" on click is worse than no button.
 */
export function PlayInHelprrButton({
  imdbId,
  tmdbId,
  tvdbId,
  size = 'default',
  variant = 'default',
  className,
  autoPlay = true,
}: {
  imdbId?: string | null;
  tmdbId?: number | string | null;
  tvdbId?: number | string | null;
  size?: 'sm' | 'default' | 'lg';
  variant?: 'default' | 'secondary' | 'outline';
  className?: string;
  /** Start playback on arrival rather than just opening the title page. */
  autoPlay?: boolean;
}) {
  const itemId = useJellyfinItemId({ imdbId, tmdbId, tvdbId });
  if (!itemId) return null;

  return (
    <Button size={size} variant={variant} className={className} asChild>
      <Link href={`/jellyfin/library/item/${itemId}${autoPlay ? '?play=1' : ''}`}>
        <Play className="fill-current" data-icon="inline-start" />
        Play
      </Link>
    </Button>
  );
}
