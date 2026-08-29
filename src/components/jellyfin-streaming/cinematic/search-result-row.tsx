'use client';

import Link from 'next/link';
import { Play } from 'lucide-react';
import { FadeInImage } from '@/components/media/fade-in-image';
import { catalogHref } from '@/components/jellyfin-streaming/card-shared';
import { jellyfinCardImage } from '@/lib/jellyfin-playback/image';
import type { JellyfinItem } from '@/types/jellyfin';

/**
 * One search hit, as the app lists them on a phone: a 16:9 still on the left,
 * the title beside it, and an outlined circular play at the right edge.
 *
 * A poster grid was the wrong shape here — search is a column you scan by
 * name, and the site never puts one on this screen.
 */
export function SearchResultRow({
  item,
  onPlay,
}: {
  item: JellyfinItem;
  onPlay?: (item: JellyfinItem) => void;
}) {
  const still = jellyfinCardImage(item, 400, 'landscape');
  const playable = Boolean(onPlay) && !item.IsFolder;

  return (
    <li className="relative flex items-center gap-3">
      <Link href={catalogHref(item)} className="flex min-w-0 flex-1 items-center gap-3 py-1.5">
        <span className="relative aspect-video w-[36%] max-w-[168px] shrink-0 overflow-hidden rounded bg-white/5">
          {still && (
            <FadeInImage src={still} alt="" fill sizes="180px" unoptimized className="object-cover" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] text-white">{item.Name}</span>
      </Link>

      {playable && (
        <button
          type="button"
          aria-label={`Play ${item.Name}`}
          onClick={() => onPlay?.(item)}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-white/70 text-white transition-colors hover:border-white"
        >
          <Play className="size-4 fill-current" />
        </button>
      )}
    </li>
  );
}
