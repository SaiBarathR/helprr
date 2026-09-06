import { cardAspectClass, type CatalogCardShape } from '@/lib/jellyfin-playback/image';
import { cn } from '@/lib/utils';

/**
 * Tiles are materially bigger than the classic skin's. With the caption gone
 * the artwork is the only thing carrying the title, so it has to be large
 * enough to actually read — every streaming service lands around six tiles
 * across a desktop viewport, not the nine or ten a management UI fits.
 */
const WIDTH_CLASS: Record<CatalogCardShape, string> = {
  portrait: 'w-[112px] sm:w-[132px] md:w-[148px] lg:w-[160px] xl:w-[176px] 2xl:w-[196px]',
  square: 'w-[112px] sm:w-[132px] md:w-[148px] lg:w-[160px] xl:w-[176px] 2xl:w-[196px]',
  landscape: 'w-[168px] sm:w-[196px] md:w-[220px] lg:w-[240px] xl:w-[262px] 2xl:w-[292px]',
};

/** Shared with rail placeholders so windowing cannot move surrounding content. */
export function cinematicCardLayout(shape: CatalogCardShape, compact: boolean): string {
  const resolved = compact && shape === 'landscape' ? 'portrait' : shape;
  return cn(cardAspectClass(resolved), WIDTH_CLASS[resolved]);
}
