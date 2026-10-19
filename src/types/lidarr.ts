import type { InstanceTag, MediaImage, QueueCustomFormat, ResolvedLabels } from './arr';
import type { DiscoverLibraryStatus } from './discover';

// Lidarr Types
export interface LidarrArtistStatistics {
  albumCount: number;
  trackFileCount: number;
  trackCount: number;
  totalTrackCount: number;
  sizeOnDisk: number;
  percentOfTracks: number;
}

export interface LidarrAlbumStatistics {
  trackFileCount: number;
  trackCount: number;
  totalTrackCount: number;
  sizeOnDisk: number;
  percentOfTracks: number;
}

export interface LidarrMedium {
  mediumNumber: number;
  mediumName: string;
  mediumFormat: string;
}

export interface LidarrLink {
  url: string;
  name: string;
}

export interface LidarrArtist {
  id: number;
  artistName: string;
  foreignArtistId: string; // MusicBrainz artist ID
  mbId?: string;
  tadbId?: number;
  discogsId?: number;
  overview: string;
  artistType: string; // Person, Group, ...
  disambiguation: string;
  status: string; // continuing, ended
  ended: boolean;
  sortName: string;
  cleanName?: string;
  monitored: boolean;
  monitorNewItems?: string; // all, none
  images: MediaImage[];
  links: LidarrLink[];
  genres: string[];
  ratings: { votes: number; value: number };
  qualityProfileId: number;
  metadataProfileId: number;
  rootFolderPath?: string;
  path?: string;
  tags: number[];
  added: string;
  statistics?: LidarrArtistStatistics;
  lastAlbum?: LidarrAlbum;
  nextAlbum?: LidarrAlbum;
}

export type LidarrArtistListItem = Pick<
  LidarrArtist,
  | 'id'
  | 'artistName'
  | 'foreignArtistId'
  | 'sortName'
  | 'status'
  | 'ended'
  | 'artistType'
  | 'disambiguation'
  | 'overview'
  | 'images'
  | 'genres'
  | 'monitored'
  | 'qualityProfileId'
  | 'metadataProfileId'
  | 'ratings'
  | 'added'
  | 'statistics'
  | 'path'
  | 'tags'
  | 'nextAlbum'
  | 'lastAlbum'
> & Partial<InstanceTag> & Partial<ResolvedLabels>;

export interface LidarrRelease {
  id: number;
  albumId: number;
  foreignReleaseId: string;
  title: string;
  status: string;
  duration: number;
  trackCount: number;
  media: LidarrMedium[];
  mediumCount: number;
  disambiguation: string;
  country: string[];
  label: string[];
  format: string;
  monitored: boolean;
}

export interface LidarrAlbum {
  id: number;
  title: string;
  disambiguation: string;
  overview: string;
  artistId: number;
  foreignAlbumId: string; // MusicBrainz release-group ID
  monitored: boolean;
  anyReleaseOk: boolean;
  profileId: number;
  duration: number;
  albumType: string; // Album, EP, Single, Broadcast, Other
  secondaryTypes: string[];
  mediumCount: number;
  ratings: { votes: number; value: number };
  releaseDate: string;
  releases: LidarrRelease[];
  images: MediaImage[];
  links: LidarrLink[];
  genres: string[];
  media?: LidarrMedium[];
  artist?: LidarrArtist;
  statistics?: LidarrAlbumStatistics;
  remoteCover?: string; // present on lookup results
}

export interface LidarrTrack {
  id: number;
  artistId: number;
  albumId: number;
  foreignTrackId: string;
  foreignRecordingId: string;
  trackFileId: number;
  explicit: boolean;
  absoluteTrackNumber: number;
  trackNumber: string;
  title: string;
  duration: number; // milliseconds
  mediumNumber: number;
  hasFile: boolean;
  ratings: { votes: number; value: number };
}

export interface LidarrMediaInfo {
  audioChannels?: number;
  audioBitRate?: string;
  audioCodec?: string;
  audioBits?: string;
  audioSampleRate?: string;
}

export interface LidarrTrackFile {
  id: number;
  artistId: number;
  albumId: number;
  path: string;
  size: number;
  dateAdded: string;
  quality: {
    quality: { id: number; name: string };
    revision?: { version: number; real: number; isRepack: boolean };
  };
  mediaInfo?: LidarrMediaInfo;
  qualityCutoffNotMet?: boolean;
  qualityWeight?: number;
  customFormats?: QueueCustomFormat[];
  customFormatScore?: number;
}

export type LidarrCalendarEntry = LidarrAlbum & { artist: LidarrArtist };

export interface LidarrArtistLookupResult {
  id?: number | null;
  artistName: string;
  foreignArtistId: string;
  artistType: string;
  disambiguation: string;
  status: string;
  ended: boolean;
  overview: string;
  images: MediaImage[];
  links: LidarrLink[];
  genres: string[];
  ratings: { votes: number; value: number };
  remotePoster?: string;
  library?: DiscoverLibraryStatus;
}

export interface LidarrAlbumLookupResult {
  id?: number | null;
  title: string;
  foreignAlbumId: string;
  artistId?: number;
  artist?: LidarrArtist;
  albumType: string;
  secondaryTypes: string[];
  releaseDate: string;
  disambiguation: string;
  overview: string;
  images: MediaImage[];
  links: LidarrLink[];
  genres: string[];
  ratings: { votes: number; value: number };
  remoteCover?: string;
}

export interface LidarrMetadataProfile {
  id: number;
  name: string;
}

export interface LidarrRenamePreview {
  artistId: number;
  albumId: number;
  trackNumbers: number[];
  trackFileId: number;
  existingPath: string;
  newPath: string;
}
