import type { ArrParsedQuality, InstanceTag, MediaImage, ResolvedLabels } from './arr';
import type { DiscoverLibraryStatus } from './discover';

// Radarr Types
export interface RadarrMovie {
  id: number;
  title: string;
  sortTitle: string;
  originalTitle?: string;
  originalLanguage?: { id: number; name: string };
  sizeOnDisk: number;
  status: string;
  overview: string;
  inCinemas?: string;
  physicalRelease?: string;
  digitalRelease?: string;
  images: MediaImage[];
  year: number;
  hasFile: boolean;
  path: string;
  qualityProfileId: number;
  monitored: boolean;
  minimumAvailability: string;
  runtime: number;
  tmdbId: number;
  imdbId: string;
  titleSlug: string;
  certification: string;
  genres: string[];
  tags: number[];
  added: string;
  ratings: {
    imdb?: { votes: number; value: number };
    tmdb?: { votes: number; value: number };
    metacritic?: { votes: number; value: number };
    rottenTomatoes?: { votes: number; value: number };
    trakt?: { votes: number; value: number };
  };
  popularity?: number;
  movieFile?: {
    id: number;
    relativePath: string;
    path?: string;
    sceneName?: string;
    releaseGroup?: string;
    edition?: string;
    indexerFlags?: number;
    originalFilePath?: string;
    qualityCutoffNotMet?: boolean;
    size: number;
    quality: {
      quality: {
        name: string;
        id?: number;
        source?: string;
        resolution?: number;
        modifier?: string;
      };
      revision?: {
        version?: number;
        real?: number;
        isRepack?: boolean;
      };
    };
    dateAdded?: string;
    customFormatScore?: number;
    language?: { id: number; name: string };
    languages?: { id: number; name: string }[];
    mediaInfo?: {
      runTime?: string | number;
      resolution?: string;
      videoCodec?: string;
      videoDynamicRange?: string;
      videoDynamicRangeType?: string;
      videoBitrate?: number | string;
      videoFps?: number | string;
      videoBitDepth?: number | string;
      scanType?: string;
      audioCodec?: string;
      audioChannels?: number | string;
      audioBitrate?: number | string;
      audioStreamCount?: number | string;
      audioLanguages?: string;
      subtitles?: string;
    };
  };
  studio: string;
}

export type RadarrMovieListItem = Pick<
  RadarrMovie,
  | 'id'
  | 'title'
  | 'sortTitle'
  | 'originalTitle'
  | 'originalLanguage'
  | 'sizeOnDisk'
  | 'status'
  | 'overview'
  | 'inCinemas'
  | 'physicalRelease'
  | 'digitalRelease'
  | 'images'
  | 'year'
  | 'hasFile'
  | 'path'
  | 'qualityProfileId'
  | 'monitored'
  | 'runtime'
  | 'genres'
  | 'tags'
  | 'added'
  | 'ratings'
  | 'popularity'
  | 'studio'
  | 'certification'
> & Partial<InstanceTag> & Partial<ResolvedLabels>;

export type RadarrCalendarEntry = RadarrMovie;

export interface RadarrRenamePreview {
  movieId: number;
  movieFileId: number;
  existingPath: string;
  newPath: string;
}

export interface RadarrParseResult {
  title: string;
  parsedMovieInfo?: { movieTitles?: string[]; year?: number; quality?: ArrParsedQuality } | null;
  /** The library movie the title maps to, when there is one. */
  movie?: { id: number; title: string; year: number; tmdbId: number; monitored: boolean } | null;
}

// Radarr collections (GET /api/v3/collection) — only the fields the gaps page uses
export interface RadarrCollectionMovie {
  tmdbId: number;
  title: string;
  year?: number;
  images?: MediaImage[];
  monitored?: boolean;
  // Extra fields returned by GET /api/v3/collection, consumed by the Collections view.
  genres?: string[];
  runtime?: number;
  status?: string;
  overview?: string;
  isExisting?: boolean; // true when the movie is already in the Radarr library
}

export interface RadarrCollection {
  id: number;
  title: string;
  tmdbId?: number;
  monitored: boolean;
  images?: MediaImage[];
  movies: RadarrCollectionMovie[];
  // Extra fields returned by GET /api/v3/collection. Defaults Radarr applies when
  // adding a missing movie from the collection (quality/root/availability/search).
  overview?: string;
  rootFolderPath?: string;
  qualityProfileId?: number;
  minimumAvailability?: string;
  searchOnAdd?: boolean;
  missingMovies?: number;
}

// ── Slim client-facing collection DTOs (returned by GET /api/radarr/collections) ──
// The raw Radarr response is ~140 KB of full movie objects; these carry only what the
// Collections grid + drawer render, keeping the payload small and the view fast.
export interface CollectionMovieSummary {
  tmdbId: number;
  title: string;
  year?: number;
  poster: string | null; // remoteUrl (TMDB), proxied client-side
  inLibrary: boolean;
  monitored: boolean;
  movieId?: number; // Radarr movie id when in library — enables deep-link + search
  hasFile?: boolean; // when in library: whether a file is present
}

export interface CollectionSummary {
  id: number;
  title: string;
  tmdbId?: number;
  monitored: boolean;
  overview?: string;
  poster: string | null;
  genres: string[];
  movieCount: number;
  missingMovies: number; // not-in-library count, from Radarr
  movies: CollectionMovieSummary[];
  instanceId?: string;
  instanceLabel?: string;
}

// Radarr Credit
export interface RadarrCredit {
  id: number;
  personName: string;
  personTmdbId: number;
  character?: string;
  department?: string;
  job?: string;
  type: 'cast' | 'crew';
  order: number;
  images: MediaImage[];
}

export interface RadarrLookupResult {
  id?: number | null;
  title: string;
  sortTitle: string;
  overview: string;
  images: MediaImage[];
  year: number;
  tmdbId: number;
  imdbId: string;
  path?: string | null;
  added?: string;
  titleSlug: string;
  certification: string;
  genres: string[];
  ratings: { imdb?: { votes: number; value: number }; tmdb?: { votes: number; value: number } };
  runtime: number;
  studio: string;
  library?: DiscoverLibraryStatus;
}
