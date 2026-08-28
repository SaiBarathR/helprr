'use client';

import { MediaTile, type MediaTileProps } from '@/components/jellyfin-streaming/media-tile';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';

/**
 * The numeral has to stand as tall as the card beside it, which is what makes
 * a ranked row read as ranked — so the ladder depends on the card's shape.
 *
 * `leading-[0.7]` lands the line box on the card's own height at these sizes,
 * so the row does not grow; the card then laps the numeral by a few pixels.
 * The landscape figures are the tile widths from MediaTile scaled by 9/16 and
 * divided by that 0.7, the portrait ones by 3/2.
 */
const NUMERAL_SIZE = {
  landscape: 'text-[8.5rem] sm:text-[10rem] md:text-[11rem] lg:text-[12rem] xl:text-[13rem] 2xl:text-[14.5rem]',
  portrait: 'text-[15rem] sm:text-[17.5rem] md:text-[19.75rem] lg:text-[21.5rem] xl:text-[23.5rem] 2xl:text-[26rem]',
} as const;

/**
 * A Top 10 cell: an oversized outlined numeral with the card beside it.
 *
 * The site's ranked row is a distinct card shape, not a relabelled rail — its
 * row pitch is much wider than a normal one. The numeral is drawn as an
 * outline in the page ground so the card reads as sitting in front of it.
 *
 * The card itself is an ordinary MediaTile, so the hover popover, the badge
 * vocabulary and the phone shape swap all come along unchanged: 16:9 on a
 * pointer viewport, exactly like every other row here, and a poster on a phone
 * where MediaTile swaps landscape for portrait on its own.
 */
export function RankedTile({ rank, ...tile }: MediaTileProps & { rank: number }) {
  const compact = useCompactViewport();
  const shape = compact ? 'portrait' : 'landscape';

  return (
    <div className="flex shrink-0 items-end">
      <span
        aria-hidden
        className={[
          'select-none font-extrabold tracking-[-0.08em] text-[#141414] leading-[0.7]',
          '-mr-3 md:-mr-5 xl:-mr-7',
          NUMERAL_SIZE[shape],
        ].join(' ')}
        style={{ WebkitTextStroke: '3px #6d6d6d' }}
      >
        {rank}
      </span>
      <MediaTile {...tile} shape={shape} />
    </div>
  );
}
