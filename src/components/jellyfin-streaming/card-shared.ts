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

/**
 * The wrapped grid the "here is a set of titles" pages use — My List, a library
 * grid, a browse list. (Search rolls its own, two-up on a phone, and is left
 * alone because it was never the broken one.)
 *
 * A grid rather than `flex flex-wrap`. The card's width ladder is sized for a
 * *rail*, so in a wrapping flex row it keeps that fixed width and the row runs
 * out early: measured on a 375px phone, My List fitted two 112px posters and
 * left 107px of a 343px content column empty. Cards in a grid pass `flat` and
 * `w-full` and take their size from the column instead — which is also why this
 * has to be a grid and not a flex row, since a flex item has no column width to
 * fill.
 *
 * Three across on a phone, where the cinematic card is a portrait poster; the
 * Netflix app's own list screens and the phone detail screen's More Like This
 * tab both run three. The count only climbs again at lg because the card
 * becomes 16:9 from md up, so three there is already a wide card.
 */
export const CATALOG_GRID_CLASS = 'grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5';

/** Classic keeps the captioned cards at their own fixed width. */
export const CATALOG_WRAP_CLASS = 'flex flex-wrap gap-3';
