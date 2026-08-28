'use client';

import { MediaTile, type MediaTileProps } from '@/components/jellyfin-streaming/media-tile';

/**
 * A Top 10 cell: an oversized outlined numeral with the poster beside it.
 *
 * The site's ranked row is a distinct card shape, not a relabelled rail — its
 * row pitch is 496px against 228 for a normal one. The numeral is drawn as an
 * outline in the page ground so the poster reads as sitting in front of it.
 *
 * The tile itself is an ordinary MediaTile, so the hover popover, the shape
 * swap and the badge vocabulary all come along unchanged.
 */
export function RankedTile({ rank, ...tile }: MediaTileProps & { rank: number }) {
  return (
    <div className="flex shrink-0 items-end">
      {/* Sized so the digit stands as tall as the poster beside it, which is
          what makes the site's ranked row read as ranked. leading-[0.7] against
          these sizes lands the line box on the poster's own height, so the row
          does not grow. The poster then laps the numeral by a few pixels. */}
      <span
        aria-hidden
        className={[
          'select-none font-extrabold tracking-[-0.08em] text-[#141414] leading-[0.7]',
          '-mr-3 md:-mr-5 xl:-mr-7',
          'text-[15rem] sm:text-[17.5rem] md:text-[19.75rem] lg:text-[21.5rem] xl:text-[23.5rem] 2xl:text-[26rem]',
        ].join(' ')}
        style={{ WebkitTextStroke: '3px #6d6d6d' }}
      >
        {rank}
      </span>
      <MediaTile {...tile} shape="portrait" />
    </div>
  );
}
