export function jellyfinImageUrl(
  itemId: string | undefined,
  type: 'Primary' | 'Backdrop' | 'Banner' | 'Thumb' | 'Logo' = 'Primary',
  maxWidth = 400,
): string | null {
  if (!itemId) return null;
  const params = new URLSearchParams({
    itemId,
    type,
    maxWidth: String(maxWidth),
  });
  return `/api/jellyfin/image?${params.toString()}`;
}

export function jellyfinBackdropUrl(
  item: { Id: string; BackdropImageTags?: string[]; ParentId?: string; SeriesId?: string },
  width = 1920,
): string | null {
  if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
    return jellyfinImageUrl(item.Id, 'Backdrop', width);
  }
  if (item.SeriesId) return jellyfinImageUrl(item.SeriesId, 'Backdrop', width);
  if (item.ParentId) return jellyfinImageUrl(item.ParentId, 'Backdrop', width);
  // No tags and no parent to borrow from: requesting it anyway is a guaranteed
  // 404 that FadeInImage then retries three times.
  return null;
}

export function jellyfinPosterUrl(item: { Id: string; ImageTags?: Record<string, string>; SeriesId?: string; ParentId?: string }, width = 400): string | null {
  if (item.ImageTags?.Primary) return jellyfinImageUrl(item.Id, 'Primary', width);
  if (item.SeriesId) return jellyfinImageUrl(item.SeriesId, 'Primary', width);
  if (item.ParentId) return jellyfinImageUrl(item.ParentId, 'Primary', width);
  return null;
}

/**
 * Card frame shapes, mirroring the vocabulary the reference install uses.
 *
 * The shape carries meaning and belongs to the *rail*, not the item:
 * landscape = watchable library content, portrait = unreleased/upcoming and
 * artists, square = albums.
 */
export type CatalogCardShape = 'landscape' | 'portrait' | 'square';

function isWideByNature(type?: string): boolean {
  return type === 'Episode' || type === 'Program';
}

/** Best 16:9 art for an item, or null when it has none. */
function jellyfinWideImageUrl(
  item: { Id: string; Type?: string; ImageTags?: Record<string, string>; BackdropImageTags?: string[] },
  width: number,
): string | null {
  // An episode's own Primary *is* the 16:9 still.
  if (isWideByNature(item.Type) && item.ImageTags?.Primary) {
    return jellyfinImageUrl(item.Id, 'Primary', width);
  }
  if (item.ImageTags?.Thumb) return jellyfinImageUrl(item.Id, 'Thumb', width);
  if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
    return jellyfinImageUrl(item.Id, 'Backdrop', width);
  }
  return null;
}

/**
 * Art for a catalog card, chosen to fit the frame the caller is drawing.
 *
 * The caller owns the shape because uniformity is a per-context decision: a
 * grid or rail with mixed aspect ratios has ragged rows. So the image bends to
 * the frame, never the other way round.
 *
 * - `landscape` (16:9): the episode still, or a movie's thumb/backdrop, and
 *   only a poster as a last resort.
 * - `portrait` (2:3): an episode's own art is a 16:9 still, so borrow the
 *   series poster rather than cropping 62% of the width away.
 * - `square` (1:1): album/artist Primary art is already square.
 */
export function jellyfinCardImage(
  item: {
    Id: string;
    Type?: string;
    ImageTags?: Record<string, string>;
    BackdropImageTags?: string[];
    SeriesId?: string;
    ParentId?: string;
  },
  width = 400,
  shape: CatalogCardShape = 'portrait',
): string | null {
  if (shape === 'landscape') {
    return jellyfinWideImageUrl(item, width) ?? jellyfinPosterUrl(item, width);
  }
  if (shape === 'portrait' && isWideByNature(item.Type)) {
    const parentId = item.SeriesId ?? item.ParentId;
    if (parentId) return jellyfinImageUrl(parentId, 'Primary', width);
  }
  return jellyfinPosterUrl(item, width);
}

/**
 * Series-level 16:9 art for an episode, which is what Continue Watching and
 * Next Up show in the reference install — the series thumb (usually carrying
 * the title treatment), not the episode still.
 */
export function jellyfinSeriesCardImage(
  item: { Id: string; Type?: string; SeriesId?: string; ParentId?: string; SeriesThumbImageTag?: string; ParentThumbImageTag?: string; ParentBackdropImageTags?: string[] },
  width = 400,
): string | null {
  const seriesId = item.SeriesId ?? item.ParentId;
  if (!seriesId) return null;
  if (item.SeriesThumbImageTag || item.ParentThumbImageTag) {
    return jellyfinImageUrl(seriesId, 'Thumb', width);
  }
  if (item.ParentBackdropImageTags && item.ParentBackdropImageTags.length > 0) {
    return jellyfinImageUrl(seriesId, 'Backdrop', width);
  }
  return null;
}

/** Aspect ratio class for a card frame. */
export function cardAspectClass(shape: CatalogCardShape): string {
  if (shape === 'landscape') return 'aspect-video';
  if (shape === 'square') return 'aspect-square';
  return 'aspect-2/3';
}

/** Null unless the person actually has an image, so the caller's initial/icon
 *  fallback fires instead of firing a request that is guaranteed to 404. */
export function jellyfinPersonImageUrl(
  person: { Id?: string; PrimaryImageTag?: string },
  width = 160,
): string | null {
  if (!person.Id || !person.PrimaryImageTag) return null;
  return jellyfinImageUrl(person.Id, 'Primary', width);
}
