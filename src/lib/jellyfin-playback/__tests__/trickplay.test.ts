import { describe, expect, it } from 'vitest';
import { pickTrickplayResolution, trickplayTileAt } from '@/lib/jellyfin-playback/trickplay';
import type { JellyfinItem } from '@/types/jellyfin';

const SOURCE = 'source-1';

function itemWith(widths: number[]): JellyfinItem {
  return {
    Id: 'item-1',
    Name: 'Movie',
    Type: 'Movie',
    MediaType: 'Video',
    Trickplay: {
      [SOURCE]: Object.fromEntries(widths.map((width) => [
        String(width),
        { Width: width, Height: Math.round(width * 0.5625), TileWidth: 10, TileHeight: 10, ThumbnailCount: 400, Interval: 10_000 },
      ])),
    },
  } as JellyfinItem;
}

describe('trickplay resolution selection', () => {
  it('prefers the largest tileset within the width cap', () => {
    expect(pickTrickplayResolution(itemWith([160, 320, 640]), SOURCE, 400)?.Width).toBe(320);
  });

  it('falls back to the smallest when everything exceeds the cap', () => {
    expect(pickTrickplayResolution(itemWith([320, 640]), SOURCE, 100)?.Width).toBe(320);
  });

  it('returns null without trickplay data or a media source', () => {
    expect(pickTrickplayResolution(itemWith([320]), undefined, 400)).toBeNull();
    expect(pickTrickplayResolution({ Id: 'x', Name: 'x', Type: 'Movie' } as JellyfinItem, SOURCE, 400)).toBeNull();
    expect(pickTrickplayResolution(null, SOURCE, 400)).toBeNull();
  });
});

describe('trickplay tile maths', () => {
  const info = { Width: 320, Height: 180, TileWidth: 10, TileHeight: 10, ThumbnailCount: 400, Interval: 10_000 };

  it('resolves the first tile at the start of playback', () => {
    const tile = trickplayTileAt(info, 'item-1', SOURCE, 0);
    expect(tile?.url).toBe('/api/jellyfin/media/Videos/item-1/Trickplay/320/0.jpg?MediaSourceId=source-1');
    expect(tile?.offsetX).toBe(0);
    expect(tile?.offsetY).toBe(0);
  });

  it('walks across then down within a tile sheet', () => {
    // Interval is 10s, so tile index == seconds / 10, and the sheet is 10 wide.
    // Tile 3 -> column 3, row 0.
    expect(trickplayTileAt(info, 'item-1', SOURCE, 30)).toMatchObject({ offsetX: -960, offsetY: 0 });
    // Tile 10 -> wraps to column 0, row 1.
    expect(trickplayTileAt(info, 'item-1', SOURCE, 100)).toMatchObject({ offsetX: 0, offsetY: -180 });
    // Tile 12 -> column 2, row 1.
    expect(trickplayTileAt(info, 'item-1', SOURCE, 120)).toMatchObject({ offsetX: -640, offsetY: -180 });
  });

  it('rolls onto the next sheet once a tile page is full', () => {
    // 100 tiles per sheet at 10s each = sheet 1 starts at 1000s.
    const tile = trickplayTileAt(info, 'item-1', SOURCE, 1000);
    expect(tile?.url).toContain('/Trickplay/320/1.jpg');
    expect(tile).toMatchObject({ offsetX: 0, offsetY: 0 });
  });

  it('degrades to null rather than a broken sprite on incomplete data', () => {
    expect(trickplayTileAt(null, 'item-1', SOURCE, 10)).toBeNull();
    expect(trickplayTileAt({ ...info, Interval: 0 }, 'item-1', SOURCE, 10)).toBeNull();
    expect(trickplayTileAt({ ...info, TileWidth: undefined }, 'item-1', SOURCE, 10)).toBeNull();
    expect(trickplayTileAt(info, 'item-1', SOURCE, -5)).toBeNull();
  });

  it('routes tiles through the Helprr proxy, never Jellyfin directly', () => {
    const tile = trickplayTileAt(info, 'item-1', SOURCE, 50);
    expect(tile?.url.startsWith('/api/jellyfin/media/')).toBe(true);
    expect(tile?.url).not.toContain('api_key');
  });
});
