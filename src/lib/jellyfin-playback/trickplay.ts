import type { JellyfinItem, JellyfinTrickplayInfo } from '@/types/jellyfin';

/**
 * Trickplay scrub thumbnails, ported from jellyfin-web
 * `controllers/playback/video/index.js` (v10.11.1): `getTrickplayResolution`
 * around line 141 and `updateTrickplayBubbleHtml` around line 1464.
 *
 * Tiles are served from `/Videos/{id}/Trickplay/{width}/{index}.jpg`, which is
 * already covered by the media proxy's `^/videos/{id}/` allowlist entry — no
 * extra route or authorization path is involved.
 */

export interface TrickplayTile {
  /** Proxied sprite sheet URL. */
  url: string;
  /** Sprite offset in px, ready for `background-position`. */
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/**
 * Pick a tileset. jellyfin-web prefers the highest resolution at or below 20%
 * of the physical screen width, falling back to the smallest available when
 * every option is larger.
 */
export function pickTrickplayResolution(
  item: JellyfinItem | null | undefined,
  mediaSourceId: string | undefined,
  maxWidthPx: number,
): JellyfinTrickplayInfo | null {
  if (!item?.Trickplay || !mediaSourceId) return null;
  const resolutions = item.Trickplay[mediaSourceId];
  if (!resolutions) return null;

  let best: JellyfinTrickplayInfo | null = null;
  for (const info of Object.values(resolutions)) {
    const width = info?.Width;
    if (!width) continue;
    if (
      !best?.Width
      || (width < best.Width && best.Width > maxWidthPx)
      || (width > best.Width && width <= maxWidthPx)
    ) {
      best = info;
    }
  }
  return best;
}

/** Screen-derived cap, matching jellyfin-web's `screen.width * dpr * 0.2`. */
export function trickplayMaxWidth(): number {
  if (typeof window === 'undefined') return 320;
  return window.screen.width * (window.devicePixelRatio || 1) * 0.2;
}

/**
 * Resolve the sprite and offset for a position. Returns null when the tileset
 * is unusable, so callers can degrade to no thumbnail rather than a broken one.
 */
export function trickplayTileAt(
  info: JellyfinTrickplayInfo | null,
  itemId: string,
  mediaSourceId: string | undefined,
  positionSeconds: number,
): TrickplayTile | null {
  if (!info?.Interval || !info.Width || !info.Height || !info.TileWidth || !info.TileHeight) {
    return null;
  }

  const currentTile = Math.floor((positionSeconds * 1000) / info.Interval);
  if (currentTile < 0) return null;

  const tileSize = info.TileWidth * info.TileHeight;
  const tileOffset = currentTile % tileSize;
  const index = Math.floor(currentTile / tileSize);

  const params = new URLSearchParams();
  if (mediaSourceId) params.set('MediaSourceId', mediaSourceId);
  const query = params.toString();

  return {
    url: `/api/jellyfin/media/Videos/${encodeURIComponent(itemId)}/Trickplay/${info.Width}/${index}.jpg${query ? `?${query}` : ''}`,
    // `|| 0` normalises negative zero, which would render as `-0px`.
    offsetX: -((tileOffset % info.TileWidth) * info.Width) || 0,
    offsetY: -(Math.floor(tileOffset / info.TileWidth) * info.Height) || 0,
    width: info.Width,
    height: info.Height,
  };
}
