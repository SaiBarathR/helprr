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
const DEFAULT_INSTANCE = 'default';
const artistDetailCache = new Map<string, ArtistDetailSnapshot>();
const albumDetailCache = new Map<string, AlbumDetailSnapshot>();

function setWithLimit<K, V>(cache: Map<K, V>, key: K, value: V) {
  cache.set(key, value);
  if (cache.size <= MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
}

// Keyed by instance so the same artist/album id in two Lidarr instances never collides.
function cacheKey(instanceId: string, id: number) {
  return `${instanceId}:${id}`;
}

function withFetchedAt<T extends SnapshotInput>(snapshot: T): T & { fetchedAt: number } {
  return {
    ...snapshot,
    fetchedAt: snapshot.fetchedAt ?? Date.now(),
  };
}

export function getArtistDetailSnapshot(artistId: number, instanceId: string = DEFAULT_INSTANCE): ArtistDetailSnapshot | null {
  return artistDetailCache.get(cacheKey(instanceId, artistId)) ?? null;
}

export function setArtistDetailSnapshot(
  artistId: number,
  snapshot: Omit<ArtistDetailSnapshot, 'fetchedAt'> & SnapshotInput,
  instanceId: string = DEFAULT_INSTANCE
) {
  setWithLimit(artistDetailCache, cacheKey(instanceId, artistId), withFetchedAt(snapshot));
}

export function getAlbumDetailSnapshot(albumId: number, instanceId: string = DEFAULT_INSTANCE): AlbumDetailSnapshot | null {
  return albumDetailCache.get(cacheKey(instanceId, albumId)) ?? null;
}

export function setAlbumDetailSnapshot(
  albumId: number,
  snapshot: Omit<AlbumDetailSnapshot, 'fetchedAt'> & SnapshotInput,
  instanceId: string = DEFAULT_INSTANCE
) {
  setWithLimit(albumDetailCache, cacheKey(instanceId, albumId), withFetchedAt(snapshot));
}

export function clearArtistDetailSnapshot(artistId: number, instanceId: string = DEFAULT_INSTANCE) {
  artistDetailCache.delete(cacheKey(instanceId, artistId));
}

export function clearAlbumDetailSnapshot(albumId: number, instanceId: string = DEFAULT_INSTANCE) {
  albumDetailCache.delete(cacheKey(instanceId, albumId));
}
