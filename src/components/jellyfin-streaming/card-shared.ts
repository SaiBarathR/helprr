import type { JellyfinItem } from '@/types/jellyfin';
import type { CatalogCardShape } from '@/lib/jellyfin-playback/image';

/**
 * Contract shared by both card skins.
 *
 * It lives here rather than in either implementation so the skin switch in
 * poster-card.tsx can import the cinematic card without the two files forming
 * an import cycle.
 */
export interface CatalogCardProps {
  item: JellyfinItem;
  onPlay?: (item: JellyfinItem) => void;
  priority?: boolean;
  className?: string;
  /** Rails that must stay one uniform height pass their shape. */
  shape?: CatalogCardShape;
  /** Renders the UPCOMING chip and suppresses the play affordance. */
  upcoming?: boolean;
  /** Overrides the derived subtitle (upcoming rails pass a countdown). */
  subtitle?: string;
  /**
   * Renders the card without the hover popover.
   *
   * The expand is a *row* behaviour — the site's own detail overlay shows
   * static cards in its More Like This grid. Left interactive, a grid cell
   * grew 1.5x over its neighbours and the edge cells were clipped by the
   * panel's own overflow.
   */
  flat?: boolean;
  /**
   * `series` makes an episode card read as its show: series art and series
   * name, with the episode in the subtitle. That is how Continue Watching and
   * Next Up present episodes in the reference install.
   */
  identity?: 'item' | 'series';
}

/**
 * Where the card body navigates.
 *
 * Everything with a detail page goes there; the play button on the card starts
 * playback in place. A live channel is the one exception — it has no detail
 * page, so it is only ever played.
 */
export function catalogHref(item: JellyfinItem): string {
  if (item.Type === 'TvChannel') return `/jellyfin/library/watch/${item.Id}`;
  return `/jellyfin/library/item/${item.Id}`;
}
