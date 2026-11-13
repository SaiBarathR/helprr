/**
 * An album not out yet, so not missing anything. Its date is read as the
 * Missing tab reads album dates (Lidarr's day at midnight UTC).
 */
export function isAlbumNotReleased(album: { releaseDate?: string | null }, now = Date.now()): boolean {
  return !!album.releaseDate && new Date(album.releaseDate).getTime() > now;
}
