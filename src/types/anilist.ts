// AniList GraphQL API Types

import type { DiscoverLibraryStatus } from './index';

export type AniListMediaFormat = 'TV' | 'TV_SHORT' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC' | 'MANGA' | 'NOVEL' | 'ONE_SHOT';
export type AniListMediaStatus = 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';
export type AniListMediaSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
export type AniListMediaType = 'ANIME' | 'MANGA';
export type AnimeBrowseSort =
  | 'seasonal'
  | 'trending'
  | 'popularity'
  | 'score'
  | 'newest'
  | 'title'
  | 'favourites'
  | 'date_added'
  | 'release_date';

export interface AniListFuzzyDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

export interface AniListTrailer {
  id: string | null;
  site: string | null;
  thumbnail: string | null;
}

export interface AniListTitle {
  romaji: string | null;
  english: string | null;
  native: string | null;
}

export interface AniListCoverImage {
  extraLarge: string | null;
  large: string | null;
  medium: string | null;
  color: string | null;
}

export interface AniListTag {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  rank: number;
  isMediaSpoiler: boolean;
  isGeneralSpoiler: boolean;
}

export interface AniListStudio {
  id: number;
  name: string;
  isAnimationStudio: boolean;
}

export interface AniListExternalLink {
  id: number;
  url: string | null;
  site: string;
  type: string | null;
}

export interface AniListCharacterName {
  full: string | null;
  native: string | null;
}

export interface AniListCharacterImage {
  large: string | null;
  medium: string | null;
}

export interface AniListVoiceActor {
  id: number;
  name: { full: string | null };
  image: { large: string | null; medium: string | null };
  language: string | null;
}

export interface AniListCharacterEdge {
  id: number;
  role: 'MAIN' | 'SUPPORTING' | 'BACKGROUND';
  node: {
    id: number;
    name: AniListCharacterName;
    image: AniListCharacterImage;
  };
  voiceActors: AniListVoiceActor[];
}

export interface AniListStaffEdge {
  id: number;
  role: string;
  node: {
    id: number;
    name: { full: string | null };
    image: { large: string | null; medium: string | null };
  };
}

export interface AniListNextAiringEpisode {
  airingAt: number;
  episode: number;
}

export interface AniListStatusDistribution {
  status: string;
  amount: number;
}

export interface AniListScoreDistribution {
  score: number;
  amount: number;
}

export interface AniListRanking {
  id: number;
  rank: number;
  type: string;
  format: string;
  year: number | null;
  season: string | null;
  allTime: boolean;
  context: string;
}

export interface AniListReview {
  id: number;
  summary: string;
  score: number;
  rating: number;
  ratingAmount: number;
  user: {
    id: number;
    name: string;
    avatar: { large: string | null; medium: string | null };
  };
}

export interface AniListRelationEdge {
  id: number;
  relationType: string;
  node: {
    id: number;
    title: AniListTitle;
    format: AniListMediaFormat | null;
    status: AniListMediaStatus | null;
    coverImage: AniListCoverImage;
    averageScore: number | null;
    episodes: number | null;
    seasonYear: number | null;
    type: AniListMediaType | null;
    chapters: number | null;
    volumes: number | null;
  };
}

export interface AniListRecommendationNode {
  id: number;
  rating: number;
  mediaRecommendation: {
    id: number;
    title: AniListTitle;
    format: AniListMediaFormat | null;
    coverImage: AniListCoverImage;
    averageScore: number | null;
    episodes: number | null;
    seasonYear: number | null;
    type: AniListMediaType | null;
    chapters: number | null;
    volumes: number | null;
  } | null;
}

export interface AniListMedia {
  id: number;
  title: AniListTitle;
  coverImage: AniListCoverImage;
  bannerImage: string | null;
  format: AniListMediaFormat | null;
  status: AniListMediaStatus | null;
  season: AniListMediaSeason | null;
  seasonYear: number | null;
  episodes: number | null;
  duration: number | null;
  genres: string[];
  tags: AniListTag[];
  averageScore: number | null;
  popularity: number | null;
  trending: number | null;
  isAdult: boolean;
  externalLinks: AniListExternalLink[];
  startDate: AniListFuzzyDate | null;
  studios: { edges: Array<{ isMain: boolean; node: AniListStudio }> } | null;
}

export interface AniListMediaDetail extends AniListMedia {
  description: string | null;
  source: string | null;
  hashtag: string | null;
  meanScore: number | null;
  favourites: number | null;
  endDate: AniListFuzzyDate | null;
  synonyms: string[] | null;
  nextAiringEpisode: AniListNextAiringEpisode | null;
  stats: {
    statusDistribution: AniListStatusDistribution[];
    scoreDistribution: AniListScoreDistribution[];
  } | null;
  rankings: AniListRanking[] | null;
  trailer: AniListTrailer | null;
  characters: { edges: AniListCharacterEdge[] } | null;
  staff: { edges: AniListStaffEdge[] } | null;
  recommendations: { nodes: AniListRecommendationNode[] } | null;
  relations: { edges: AniListRelationEdge[] } | null;
  reviews: { nodes: AniListReview[] } | null;
}

export interface AniListMangaDetail extends AniListMedia {
  description: string | null;
  source: string | null;
  hashtag: string | null;
  meanScore: number | null;
  favourites: number | null;
  trailer: AniListTrailer | null;
  characters: { edges: AniListCharacterEdge[] } | null;
  staff: { edges: AniListStaffEdge[] } | null;
  recommendations: { nodes: AniListRecommendationNode[] } | null;
  relations: { edges: AniListRelationEdge[] } | null;
  reviews: { nodes: AniListReview[] } | null;
  chapters: number | null;
  volumes: number | null;
  endDate: AniListFuzzyDate | null;
}

export interface AniListPageInfo {
  total: number;
  currentPage: number;
  lastPage: number;
  hasNextPage: boolean;
  perPage: number;
}

export interface AniListBrowseFilters {
  genre?: string;
  genres?: string[];
  year?: number;
  season?: AniListMediaSeason;
  format?: AniListMediaFormat[];
  status?: AniListMediaStatus;
  sort?: AnimeBrowseSort;
}

export interface AniListListItem {
  id: number;
  title: string;
  titleRomaji: string | null;
  titleNative: string | null;
  coverImage: string | null;
  bannerImage: string | null;
  format: AniListMediaFormat | null;
  status: AniListMediaStatus | null;
  season: AniListMediaSeason | null;
  seasonYear: number | null;
  episodes: number | null;
  duration: number | null;
  genres: string[];
  averageScore: number | null;
  popularity: number | null;
  trending: number | null;
  isAdult: boolean;
  studios: string[];
  year: number | null;
  coverImageColor: string | null;
}

export type SeriesAniListMappingState =
  | 'AUTO_MATCH'
  | 'AUTO_UNMATCHED'
  | 'MANUAL_MATCH'
  | 'MANUAL_NONE';

export interface SeriesAniListCandidate {
  id: number;
  title: string;
  titleRomaji: string | null;
  titleNative: string | null;
  coverImage: string | null;
  format: AniListMediaFormat | null;
  status: AniListMediaStatus | null;
  seasonYear: number | null;
  episodes: number | null;
  averageScore: number | null;
  popularity: number | null;
  matchScore: number;
}

/** One linked AniList entry for a Sonarr series (season-split anime support). */
export interface SeriesAniListEntry {
  anilistMediaId: number;
  isPrimary: boolean;
  order: number;
  /** 'auto' when the system linked it (auto-match / season discovery); 'manual' when a user picked it. */
  source: 'auto' | 'manual';
  /** AniList preferred title at link time — display fallback without an API call. */
  titleSnapshot: string | null;
}

export interface SeriesAniListMapping {
  sonarrSeriesId: number;
  /** Convenience: the primary entry's AniList id (or null when unmatched). */
  primaryAnilistMediaId: number | null;
  /** All linked AniList entries, ordered (index 0 = primary). Empty when unmatched. */
  entries: SeriesAniListEntry[];
  state: SeriesAniListMappingState;
  matchMethod: string | null;
  confidence: number | null;
  resolvedAt: string;
}

export interface SeriesAniListResponse {
  mapping: SeriesAniListMapping;
  /**
   * Linked entry details, ordered (index 0 = primary). Empty when unmatched.
   * The page-load GET returns only the primary (lazy per-tab loading);
   * `?full=1` and all mutation responses return every entry.
   */
  details: AniListDetailResponse[];
}

/** Lazy per-tab fetch (`GET …/anime?detail=<id>`). `detail: null` = the entry is unknown or was pruned — refetch the full response to resync. */
export interface SeriesAniListEntryDetailResponse {
  mapping: SeriesAniListMapping;
  detail: AniListDetailResponse | null;
}

/** A Sonarr series currently mapped to a given AniList media (reverse lookup). */
export interface AnimeSonarrMappingItem {
  sonarrInstanceId: string;
  sonarrSeriesId: number;
  state: SeriesAniListMappingState;
  seriesTitle: string;
  seriesYear: number | null;
}

export interface AnimeSonarrMappingsResponse {
  mappings: AnimeSonarrMappingItem[];
}

/** Admin settings view: one linked entry, rendered from snapshots (no AniList calls). */
export interface AdminAnimeMappingEntry {
  anilistMediaId: number;
  isPrimary: boolean;
  order: number;
  source: 'auto' | 'manual';
  titleSnapshot: string | null;
}

/** Admin settings view: one series' mapping row. */
export interface AdminAnimeMappingRow {
  sonarrInstanceId: string;
  sonarrInstanceLabel: string;
  sonarrSeriesId: number;
  seriesTitle: string;
  seriesYear: number | null;
  state: SeriesAniListMappingState;
  matchMethod: string | null;
  confidence: number | null;
  resolvedAt: string;
  entries: AdminAnimeMappingEntry[];
}

export interface AdminAnimeMappingsResponse {
  mappings: AdminAnimeMappingRow[];
  total: number;
}

export interface AniListDetailResponse {
  id: number;
  title: string;
  titleRomaji: string | null;
  titleNative: string | null;
  description: string | null;
  coverImage: string | null;
  bannerImage: string | null;
  format: AniListMediaFormat | null;
  status: AniListMediaStatus | null;
  season: AniListMediaSeason | null;
  seasonYear: number | null;
  episodes: number | null;
  duration: number | null;
  genres: string[];
  tags: Array<{ name: string; rank: number; isSpoiler: boolean }>;
  averageScore: number | null;
  meanScore: number | null;
  popularity: number | null;
  favourites: number | null;
  isAdult: boolean;
  source: string | null;
  hashtag: string | null;
  startDate: AniListFuzzyDate | null;
  endDate: AniListFuzzyDate | null;
  synonyms: string[];
  nextAiringEpisode: AniListNextAiringEpisode | null;
  statusDistribution: AniListStatusDistribution[];
  scoreDistribution: AniListScoreDistribution[];
  rankings: AniListRanking[];
  trailer: AniListTrailer | null;
  studios: Array<{ id: number; name: string; isMain: boolean }>;
  characters: Array<{
    id: number;
    name: string;
    image: string | null;
    role: string;
    voiceActor: { id: number; name: string; image: string | null; language: string | null } | null;
  }>;
  staff: Array<{
    id: number;
    name: string;
    image: string | null;
    role: string;
  }>;
  relations: Array<{
    id: number;
    title: string;
    coverImage: string | null;
    format: AniListMediaFormat | null;
    status: AniListMediaStatus | null;
    relationType: string;
    averageScore: number | null;
    episodes: number | null;
    seasonYear: number | null;
    type: AniListMediaType | null;
    chapters: number | null;
    volumes: number | null;
  }>;
  recommendations: Array<{
    id: number;
    title: string;
    coverImage: string | null;
    format: AniListMediaFormat | null;
    averageScore: number | null;
    episodes: number | null;
    seasonYear: number | null;
    rating: number;
    type: AniListMediaType | null;
    chapters: number | null;
    volumes: number | null;
    // Added by the detail route: year (from seasonYear) + arr library membership.
    year?: number | null;
    library?: DiscoverLibraryStatus;
  }>;
  reviews: AniListReview[];
  externalLinks: AniListExternalLink[];
  tvdbId: number | null;
  malId: number | null;
  tmdbId: number | null;
  year: number | null;
}

export interface AniListMangaDetailResponse {
  id: number;
  title: string;
  titleRomaji: string | null;
  titleNative: string | null;
  description: string | null;
  coverImage: string | null;
  bannerImage: string | null;
  format: AniListMediaFormat | null;
  status: AniListMediaStatus | null;
  chapters: number | null;
  volumes: number | null;
  genres: string[];
  tags: Array<{ name: string; rank: number; isSpoiler: boolean }>;
  averageScore: number | null;
  meanScore: number | null;
  popularity: number | null;
  favourites: number | null;
  isAdult: boolean;
  source: string | null;
  startDate: AniListFuzzyDate | null;
  endDate: AniListFuzzyDate | null;
  staff: Array<{
    id: number;
    name: string;
    image: string | null;
    role: string;
  }>;
  relations: Array<{
    id: number;
    title: string;
    coverImage: string | null;
    format: AniListMediaFormat | null;
    status: AniListMediaStatus | null;
    relationType: string;
    averageScore: number | null;
    episodes: number | null;
    seasonYear: number | null;
    type: AniListMediaType | null;
    chapters: number | null;
    volumes: number | null;
  }>;
  recommendations: Array<{
    id: number;
    title: string;
    coverImage: string | null;
    format: AniListMediaFormat | null;
    averageScore: number | null;
    episodes: number | null;
    seasonYear: number | null;
    rating: number;
    type: AniListMediaType | null;
    chapters: number | null;
    volumes: number | null;
  }>;
  reviews: AniListReview[];
  externalLinks: AniListExternalLink[];
}

export interface AniListPageResponse {
  pageInfo: AniListPageInfo;
  media: AniListMedia[];
}

// --- Airing Schedule ---

export interface AniListAiringScheduleMedia {
  id: number;
  title: AniListTitle;
  coverImage: AniListCoverImage;
  format: AniListMediaFormat | null;
  status: AniListMediaStatus | null;
  season: AniListMediaSeason | null;
  seasonYear: number | null;
  episodes: number | null;
  duration: number | null;
  averageScore: number | null;
  meanScore: number | null;
  isAdult: boolean;
  genres: string[];
  studios: { nodes: Array<{ id: number; name: string }> } | null;
}

export interface AniListAiringSchedule {
  id: number;
  episode: number;
  airingAt: number;
  media: AniListAiringScheduleMedia;
}

export interface AniListScheduleEntry {
  scheduleId: number;
  episode: number;
  airingAt: number;
  media: {
    id: number;
    title: string;
    titleRomaji: string | null;
    titleNative: string | null;
    coverImage: string | null;
    coverImageColor: string | null;
    format: AniListMediaFormat | null;
    status: AniListMediaStatus | null;
    season: AniListMediaSeason | null;
    seasonYear: number | null;
    episodes: number | null;
    duration: number | null;
    averageScore: number | null;
    meanScore: number | null;
    genres: string[];
    studios: string[];
    year: number | null;
  };
}

// --- Staff Detail ---

export interface AniListStaffMediaEdge {
  staffRole: string;
  node: {
    id: number;
    title: string;
    coverImage: string | null;
    format: AniListMediaFormat | null;
    type: AniListMediaType | null;
    averageScore: number | null;
    popularity: number | null;
    favourites: number | null;
    seasonYear: number | null;
    startDate: AniListFuzzyDate | null;
    episodes: number | null;
    chapters: number | null;
  };
}

export interface AniListStaffVoiceActingEdge {
  characterRole: string;
  characterName: string | null;
  characters: Array<{
    id: number;
    name: string;
    image: string | null;
  }>;
  node: AniListStaffMediaEdge['node'];
}

export interface AniListStaffDetailResponse {
  id: number;
  name: string;
  nameNative: string | null;
  nameAlternative: string[];
  image: string | null;
  description: string | null;
  primaryOccupations: string[];
  gender: string | null;
  dateOfBirth: AniListFuzzyDate | null;
  dateOfDeath: AniListFuzzyDate | null;
  age: number | null;
  yearsActive: number[];
  homeTown: string | null;
  bloodType: string | null;
  languageV2: string | null;
  favourites: number | null;
  siteUrl: string | null;
  animeMedia: AniListStaffMediaEdge[];
  animePageInfo: AniListPageInfo;
  mangaMedia: AniListStaffMediaEdge[];
  mangaPageInfo: AniListPageInfo;
  voiceActingMedia: AniListStaffVoiceActingEdge[];
  voiceActingPageInfo: AniListPageInfo;
}

// --- Character Detail ---

export interface AniListCharacterMediaEdge {
  characterRole: string;
  voiceActors: Array<{
    id: number;
    name: string;
    image: string | null;
    language: string | null;
  }>;
  node: {
    id: number;
    title: string;
    coverImage: string | null;
    format: AniListMediaFormat | null;
    type: AniListMediaType | null;
    averageScore: number | null;
    popularity: number | null;
    favourites: number | null;
    seasonYear: number | null;
    startDate: AniListFuzzyDate | null;
    episodes: number | null;
    chapters: number | null;
  };
}

export interface AniListCharacterDetailResponse {
  id: number;
  name: string;
  nameNative: string | null;
  nameAlternative: string[];
  nameSpoiler: string[];
  image: string | null;
  description: string | null;
  gender: string | null;
  dateOfBirth: AniListFuzzyDate | null;
  age: string | null;
  bloodType: string | null;
  favourites: number | null;
  siteUrl: string | null;
  media: AniListCharacterMediaEdge[];
  mediaPageInfo: AniListPageInfo;
}

// --- Studio Detail ---

export interface AniListStudioMediaNode {
  id: number;
  title: string;
  coverImage: string | null;
  format: AniListMediaFormat | null;
  type: AniListMediaType | null;
  averageScore: number | null;
  popularity: number | null;
  favourites: number | null;
  seasonYear: number | null;
  startDate: AniListFuzzyDate | null;
  episodes: number | null;
  chapters: number | null;
  status: AniListMediaStatus | null;
  season: AniListMediaSeason | null;
  nextAiringEpisode: AniListNextAiringEpisode | null;
  genres: string[];
}

export interface AniListStudioDetailResponse {
  id: number;
  name: string;
  isAnimationStudio: boolean;
  favourites: number | null;
  siteUrl: string | null;
  media: AniListStudioMediaNode[];
  mediaPageInfo: AniListPageInfo;
}

export type AniListSort =
  | 'TRENDING_DESC'
  | 'POPULARITY_DESC'
  | 'SCORE_DESC'
  | 'START_DATE_DESC'
  | 'START_DATE'
  | 'TITLE_ROMAJI'
  | 'FAVOURITES_DESC'
  | 'ID_DESC';
