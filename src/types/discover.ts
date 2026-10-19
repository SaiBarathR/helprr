export type DiscoverMediaType = 'movie' | 'tv';
export type DiscoverContentType = 'all' | 'movie' | 'show';
export type DiscoverMode = 'sections' | 'browse' | 'search';

export interface DiscoverGenre {
  id: number;
  name: string;
  type: DiscoverMediaType;
}

export interface DiscoverProvider {
  id: number;
  name: string;
  logoPath: string | null;
  displayPriority: number;
  type: DiscoverMediaType;
}

export interface DiscoverNetwork {
  id: number;
  name: string;
  logoPath: string | null;
}

export interface DiscoverLibraryStatus {
  exists: boolean;
  type?: 'movie' | 'series';
  id?: number;
  titleSlug?: string;
  tmdbId?: number;
  /** The instance that holds the top-level id/titleSlug, for deep-linking. */
  instanceId?: string;
  /** Every connected instance that holds this title (multi-instance). The top-level
   * id/titleSlug/instanceId mirror the first/highest-priority instance for back-compat. */
  instances?: Array<{ instanceId: string; instanceLabel: string; id: number; titleSlug?: string }>;
}

export interface DiscoverItem {
  id: number;
  tmdbId: number;
  mediaType: DiscoverMediaType;
  title: string;
  originalTitle?: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  year: number | null;
  rating: number;
  voteCount: number;
  popularity: number;
  genres: number[];
  genreNames?: string[];
  originalLanguage?: string;
  originCountry?: string[];
  library?: DiscoverLibraryStatus;
}

export interface DiscoverSection {
  key: string;
  title: string;
  type: 'media' | 'genre' | 'provider' | 'network';
  mediaType?: DiscoverMediaType | 'all';
  items: DiscoverItem[] | DiscoverGenre[] | DiscoverProvider[] | DiscoverNetwork[];
}

export interface DiscoverFilters {
  genres?: number[];
  yearFrom?: number;
  yearTo?: number;
  runtimeMin?: number;
  runtimeMax?: number;
  language?: string;
  region?: string;
  ratingMin?: number;
  ratingMax?: number;
  voteCountMin?: number;
  providers?: number[];
  networks?: number[];
  companies?: number[];
  releaseState?: 'released' | 'upcoming' | 'airing' | 'ended';
  withPeople?: number[];
  withCast?: number[];
  withCrew?: number[];
}

export interface DiscoverFiltersResponse {
  genres: DiscoverGenre[];
  providers: DiscoverProvider[];
  networks: DiscoverNetwork[];
  regions: Array<{ code: string; name: string }>;
  languages: Array<{ code: string; name: string }>;
  releaseStates: Array<{ value: string; label: string }>;
}

export interface DiscoverResponse {
  mode: DiscoverMode;
  page?: number;
  totalPages?: number;
  totalResults?: number;
  items?: DiscoverItem[];
  sections?: DiscoverSection[];
}

export interface DiscoverDetail extends DiscoverItem {
  runtime: number | null;
  status: string | null;
  imdbId?: string | null;
  tvdbId?: number | null;
  productionCompanies: Array<{ id: number; name: string; logoPath: string | null }>;
  networks: Array<{ id: number; name: string; logoPath: string | null }>;
  addTarget: {
    service: 'radarr' | 'sonarr';
    exists: boolean;
    id?: number;
    // The instance the matched item lives in (when exists). Detail-page links use
    // it so a non-default-instance item caches under the same ?instance= slot.
    instanceId?: string;
    // Instances whose library could not be read: whether they hold the title is unknown.
    uncheckedInstanceIds?: string[];
  };
}

export interface DiscoverCastMember {
  id: number;
  name: string;
  character: string;
  profilePath: string | null;
  order: number;
}

export interface DiscoverCrewMember {
  id: number;
  name: string;
  department: string;
  job: string;
  profilePath: string | null;
}

export interface DiscoverAggregateCastMember {
  id: number;
  name: string;
  profilePath: string | null;
  character: string;
  episodeCount: number;
  order: number;
}

export interface DiscoverVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

export interface DiscoverWatchProviderEntry {
  logoPath: string;
  providerId: number;
  providerName: string;
}

export interface DiscoverWatchProviders {
  /** Region the returned entries belong to (ISO 3166-1 alpha-2). */
  region: string;
  /** Region the caller asked for; may differ from `region` when a fallback was used. */
  requestedRegion: string;
  link?: string;
  flatrate?: DiscoverWatchProviderEntry[];
  rent?: DiscoverWatchProviderEntry[];
  buy?: DiscoverWatchProviderEntry[];
}

export interface DiscoverSeasonBrief {
  id: number;
  airDate: string | null;
  episodeCount: number;
  name: string;
  overview: string;
  posterPath: string | null;
  seasonNumber: number;
  voteAverage: number;
}

export interface DiscoverMovieFullDetail extends DiscoverDetail {
  tagline: string | null;
  budget: number | null;
  revenue: number | null;
  homepage: string | null;
  certification: string | null;
  collection: {
    id: number;
    name: string;
    posterPath: string | null;
    backdropPath: string | null;
  } | null;
  cast: DiscoverCastMember[];
  crew: DiscoverCrewMember[];
  videos: DiscoverVideo[];
  similar: DiscoverItem[];
  recommendations: DiscoverItem[];
  watchProviders: DiscoverWatchProviders | null;
}

export interface DiscoverTvFullDetail extends DiscoverDetail {
  tagline: string | null;
  homepage: string | null;
  certification: string | null;
  createdBy: Array<{ id: number; name: string; profilePath: string | null }>;
  numberOfSeasons: number;
  numberOfEpisodes: number;
  lastAirDate: string | null;
  nextEpisode: {
    name: string;
    airDate: string | null;
    episodeNumber: number;
    seasonNumber: number;
  } | null;
  showType: string | null;
  seasons: DiscoverSeasonBrief[];
  cast: DiscoverAggregateCastMember[];
  crew: DiscoverCrewMember[];
  videos: DiscoverVideo[];
  similar: DiscoverItem[];
  recommendations: DiscoverItem[];
  watchProviders: DiscoverWatchProviders | null;
}

export interface DiscoverSeasonEpisode {
  id: number;
  name: string;
  overview: string;
  airDate: string | null;
  episodeNumber: number;
  seasonNumber: number;
  stillPath: string | null;
  voteAverage: number;
  runtime: number | null;
}

export interface DiscoverSeasonDetailResponse {
  id: number;
  name: string;
  overview: string;
  airDate: string | null;
  posterPath: string | null;
  seasonNumber: number;
  episodes: DiscoverSeasonEpisode[];
}

export interface DiscoverCollectionDetail {
  id: number;
  name: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  parts: DiscoverItem[];
}
