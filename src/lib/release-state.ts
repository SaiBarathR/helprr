/**
 * An album not out yet, so not missing anything. Its date is read as the
 * Missing tab reads album dates (Lidarr's day at midnight UTC).
 */
export function isAlbumNotReleased(album: { releaseDate?: string | null }, now = Date.now()): boolean {
  return !!album.releaseDate && new Date(album.releaseDate).getTime() > now;
}

/**
 * An episode not aired yet, so not missing anything: its air time is ahead or
 * not known (Sonarr counts an episode missing only once it has aired).
 */
export function isEpisodeNotAired(episode: { airDateUtc?: string | null; airDate?: string | null }, now = Date.now()): boolean {
  const when = episode.airDateUtc || episode.airDate;
  if (!when) return true;
  const airsAt = new Date(when).getTime();
  return Number.isFinite(airsAt) && airsAt > now;
}

type AlbumTracks = { releaseDate?: string | null; statistics?: { trackFileCount: number; totalTrackCount: number } | null };

/**
 * An artist's badge from its albums, counting only those already out: an
 * album still to come is not missing anything, and an artist with nothing out
 * yet is not released.
 */
export function artistTrackState(albums: AlbumTracks[], now = Date.now()): 'complete' | 'missing' | 'notReleased' {
  const out = albums.filter((album) => !isAlbumNotReleased(album, now));
  if (out.length === 0) return albums.length > 0 ? 'notReleased' : 'missing';
  const tracks = out.flatMap((album) => (album.statistics ? [album.statistics] : []));
  const complete = tracks.some((s) => s.totalTrackCount > 0) && tracks.every((s) => s.trackFileCount >= s.totalTrackCount);
  return complete ? 'complete' : 'missing';
}
