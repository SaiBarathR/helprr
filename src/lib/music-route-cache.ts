import type {
  LidarrArtist,
  LidarrAlbum,
  LidarrTrack,
  LidarrTrackFile,
  QualityProfile,
  LidarrMetadataProfile,
  Tag,
} from '@/types';

export interface ArtistDetailSnapshot {
  artist: LidarrArtist | null;
  albums: LidarrAlbum[];
  qualityProfiles: QualityProfile[];
  metadataProfiles: LidarrMetadataProfile[];
  tags: Tag[];
  fetchedAt: number;
}

export interface AlbumDetailSnapshot {
  album: LidarrAlbum | null;
  tracks: LidarrTrack[];
  trackFiles: LidarrTrackFile[];
  fetchedAt: number;
}

interface SnapshotInput {
  fetchedAt?: number;
}

const MAX_ENTRIES = 100;
const artistDetailCache = new Map<number, ArtistDetailSnapshot>();
const albumDetailCache = new Map<number, AlbumDetailSnapshot>();

function setWithLimit<K, V>(cache: Map<K, V>, key: K, value: V) {
  cache.set(key, value);
  if (cache.size <= MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
}

function withFetchedAt<T extends SnapshotInput>(snapshot: T): T & { fetchedAt: number } {
  return {
    ...snapshot,
    fetchedAt: snapshot.fetchedAt ?? Date.now(),
  };
}

export function getArtistDetailSnapshot(artistId: number): ArtistDetailSnapshot | null {
  return artistDetailCache.get(artistId) ?? null;
}

export function setArtistDetailSnapshot(
  artistId: number,
  snapshot: Omit<ArtistDetailSnapshot, 'fetchedAt'> & SnapshotInput
) {
  setWithLimit(artistDetailCache, artistId, withFetchedAt(snapshot));
}

export function getAlbumDetailSnapshot(albumId: number): AlbumDetailSnapshot | null {
  return albumDetailCache.get(albumId) ?? null;
}

export function setAlbumDetailSnapshot(
  albumId: number,
  snapshot: Omit<AlbumDetailSnapshot, 'fetchedAt'> & SnapshotInput
) {
  setWithLimit(albumDetailCache, albumId, withFetchedAt(snapshot));
}

export function clearArtistDetailSnapshot(artistId: number) {
  artistDetailCache.delete(artistId);
}

export function clearAlbumDetailSnapshot(albumId: number) {
  albumDetailCache.delete(albumId);
}
