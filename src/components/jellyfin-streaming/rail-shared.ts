import type { JellyfinItem } from '@/types/jellyfin';
import type { CatalogCardShape } from '@/lib/jellyfin-playback/image';

/**
 * Contract shared by both rail skins. Kept out of either implementation so the
 * skin switch in catalog-rail.tsx can import the cinematic rail without the
 * two files forming an import cycle.
 */
export interface CatalogRailProps {
  title: string;
  items: JellyfinItem[];
  onPlay?: (item: JellyfinItem) => void;
  href?: string;
  shape?: CatalogCardShape;
  upcoming?: boolean;
  subtitleFor?: (item: JellyfinItem) => string | undefined;
  identity?: 'item' | 'series';
}
