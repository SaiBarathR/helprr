// The detail page a notification opens, from the ids an *arr event carries.
// Used when a notification is sent (polling) and when the notifications page
// resolves an older one. Season 0 holds a series' specials, so only a missing
// season number falls back to the series page.

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function getMediaHrefFromIds(args: {
  seriesId?: unknown;
  seasonNumber?: unknown;
  episodeId?: unknown;
  movieId?: unknown;
  albumId?: unknown;
  artistId?: unknown;
  instanceId?: unknown;
}): string | null {
  // Keep the deep-link on the instance the event came from; detail pages read
  // ?instance and fall back to the default when it's absent.
  const instance = typeof args.instanceId === 'string' && args.instanceId ? args.instanceId : null;
  const withInstance = (href: string) => (instance ? `${href}?instance=${instance}` : href);

  const movieId = toNumber(args.movieId);
  if (movieId) return withInstance(`/movies/${movieId}`);

  const albumId = toNumber(args.albumId);
  if (albumId) return withInstance(`/music/album/${albumId}`);
  const artistId = toNumber(args.artistId);
  if (artistId) return withInstance(`/music/${artistId}`);

  const seriesId = toNumber(args.seriesId);
  const seasonNumber = toNumber(args.seasonNumber);
  const episodeId = toNumber(args.episodeId);
  if (seriesId && seasonNumber !== undefined && episodeId) {
    return withInstance(`/series/${seriesId}/season/${seasonNumber}/episode/${episodeId}`);
  }
  if (seriesId && seasonNumber !== undefined) {
    return withInstance(`/series/${seriesId}/season/${seasonNumber}`);
  }
  if (seriesId) {
    return withInstance(`/series/${seriesId}`);
  }
  return null;
}
