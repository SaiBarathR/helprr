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

export function jellyfinBackdropUrl(item: { Id: string; BackdropImageTags?: string[]; ParentId?: string; SeriesId?: string }): string | null {
  if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
    return jellyfinImageUrl(item.Id, 'Backdrop', 1920);
  }
  if (item.SeriesId) return jellyfinImageUrl(item.SeriesId, 'Backdrop', 1920);
  if (item.ParentId) return jellyfinImageUrl(item.ParentId, 'Backdrop', 1920);
  return jellyfinImageUrl(item.Id, 'Backdrop', 1920);
}

export function jellyfinPosterUrl(item: { Id: string; ImageTags?: Record<string, string>; SeriesId?: string; ParentId?: string }, width = 400): string | null {
  if (item.ImageTags?.Primary) return jellyfinImageUrl(item.Id, 'Primary', width);
  if (item.SeriesId) return jellyfinImageUrl(item.SeriesId, 'Primary', width);
  if (item.ParentId) return jellyfinImageUrl(item.ParentId, 'Primary', width);
  return null;
}
