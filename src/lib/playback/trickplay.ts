// Trickplay sprite math (plan §F): Jellyfin pre-generates JPEG tile sheets per
// resolution; the scrubber preview picks the thumbnail for a time and shows it
// as a CSS sprite. Browser-only.

import type { PlayableItem, TrickplayInfo } from '@/types/jellyfin-playback';

/** Preferred preview resolution — the closest generated width wins. */
const TARGET_WIDTH = 320;

/** Everything the controls need to render previews without holding the ticket. */
export interface TrickplayHandle {
  info: TrickplayInfo;
  urlForTile: (tileIndex: number) => string;
}

export interface TrickplaySprite {
  /** Which tile-sheet JPEG (the {tileIndex}.jpg path segment). */
  tileIndex: number;
  /** Pixel offsets of the thumbnail inside the sheet. */
  offsetX: number;
  offsetY: number;
}

export function resolveTrickplay(
  item: PlayableItem,
  mediaSourceId: string
): TrickplayInfo | null {
  const byWidth =
    item.Trickplay?.[mediaSourceId] ?? Object.values(item.Trickplay ?? {})[0];
  if (!byWidth) return null;
  const infos = Object.values(byWidth);
  if (infos.length === 0) return null;
  return infos.reduce((best, info) =>
    Math.abs(info.Width - TARGET_WIDTH) < Math.abs(best.Width - TARGET_WIDTH) ? info : best
  );
}

export function spriteForTime(info: TrickplayInfo, seconds: number): TrickplaySprite {
  // Interval is in milliseconds; TileWidth/TileHeight are tiles per row/column.
  const thumbnail = Math.max(
    0,
    Math.min(Math.floor((seconds * 1000) / info.Interval), info.ThumbnailCount - 1)
  );
  const perSheet = info.TileWidth * info.TileHeight;
  const within = thumbnail % perSheet;
  return {
    tileIndex: Math.floor(thumbnail / perSheet),
    offsetX: (within % info.TileWidth) * info.Width,
    offsetY: Math.floor(within / info.TileWidth) * info.Height,
  };
}
