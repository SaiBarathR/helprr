'use client';

import { spriteForTime, type TrickplayHandle } from '@/lib/playback/trickplay';

export const PREVIEW_WIDTH_PX = 160;

/** Scrubber thumbnail: one tile of a Jellyfin trickplay sheet, scaled to fit. */
export function TrickplayPreview({
  trickplay,
  seconds,
}: {
  trickplay: TrickplayHandle;
  seconds: number;
}) {
  const { info } = trickplay;
  const sprite = spriteForTime(info, seconds);
  const scale = PREVIEW_WIDTH_PX / info.Width;
  return (
    <div
      className="overflow-hidden rounded-md border border-white/20 bg-black shadow-lg"
      style={{ width: Math.round(info.Width * scale), height: Math.round(info.Height * scale) }}
    >
      <div
        style={{
          width: info.Width,
          height: info.Height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          backgroundImage: `url("${trickplay.urlForTile(sprite.tileIndex)}")`,
          backgroundPosition: `-${sprite.offsetX}px -${sprite.offsetY}px`,
        }}
      />
    </div>
  );
}
