// AniList GraphQL API Types

export type AniListMediaFormat = 'TV' | 'TV_SHORT' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC' | 'MANGA' | 'NOVEL' | 'ONE_SHOT';
export type AniListMediaStatus = 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';
export type AniListMediaSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
export type AniListMediaType = 'ANIME' | 'MANGA';

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
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  studios: { edges: Array<{ isMain: boolean; node: AniListStudio }> } | null;
}

export interface AniListMediaDetail extends AniListMedia {
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
  sort?: string;
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
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  endDate: { year: number | null; month: number | null; day: number | null } | null;
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

export type AniListSort =
  | 'TRENDING_DESC'
  | 'POPULARITY_DESC'
  | 'SCORE_DESC'
  | 'START_DATE_DESC'
  | 'TITLE_ROMAJI'
  | 'FAVOURITES_DESC'
  | 'ID_DESC';
