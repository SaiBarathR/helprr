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
