import axios from 'axios';
import type {
  AniListMedia,
  AniListMediaDetail,
  AniListMangaDetail,
  AniListMediaFormat,
  AniListNextAiringEpisode,
  AniListMediaSeason,
  AniListMediaStatus,
  AniListPageInfo,
  AniListSort,
  AnimeBrowseSort,
} from '@/types/anilist';
import { getAnilistJsonWithCache, type AnilistCachePolicy } from '@/lib/cache/anilist-api-cache';
import { getCurrentSeason } from '@/lib/anilist-helpers';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const ANILIST_TIMEOUT_MS = 10_000;

// Rate limiting: 90 req/min
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 85; // leave a small buffer
const requestTimestamps: number[] = [];

async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  // Remove timestamps older than the window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT_MAX) {
    const oldest = requestTimestamps[0];
    const waitMs = oldest + RATE_LIMIT_WINDOW_MS - now + 100;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  requestTimestamps.push(Date.now());
}

const MEDIA_LIST_FRAGMENT = `
  id
  title { romaji english native }
  coverImage { extraLarge large medium color }
  bannerImage
  format
  status
  season
  seasonYear
  episodes
  duration
  genres
  tags { id name rank isMediaSpoiler isGeneralSpoiler }
  averageScore
  popularity
  trending
  isAdult
  externalLinks { id url site type }
  startDate { year month day }
  studios { edges { isMain node { id name isAnimationStudio } } }
`;

const MEDIA_DETAIL_FRAGMENT = `
  ${MEDIA_LIST_FRAGMENT}
  description
  source
  hashtag
  meanScore
  favourites
  endDate { year month day }
  synonyms
  nextAiringEpisode { airingAt episode }
  stats {
    statusDistribution { status amount }
    scoreDistribution { score amount }
  }
  rankings { id rank type format year season allTime context }
  trailer { id site thumbnail }
  characters(sort: [ROLE, RELEVANCE], perPage: 25) {
    edges {
      id
      role
      node { id name { full native } image { large medium } }
      voiceActors(language: JAPANESE) { id name { full } image { large medium } language }
    }
  }
  staff(sort: RELEVANCE, perPage: 15) {
    edges {
      id
      role
      node { id name { full } image { large medium } }
    }
  }
  recommendations(sort: RATING_DESC, perPage: 15) {
    nodes {
      id
      rating
      mediaRecommendation {
        id
        title { romaji english native }
        format
        coverImage { extraLarge large medium color }
        averageScore
        episodes
        seasonYear
        type
        chapters
        volumes
      }
    }
  }
  relations {
    edges {
      id
      relationType
      node {
        id
        title { romaji english native }
        format
        status
        coverImage { extraLarge large medium color }
        averageScore
        episodes
        seasonYear
        type
        chapters
        volumes
      }
    }
  }
  reviews(sort: RATING_DESC, perPage: 5) {
    nodes {
      id
      summary
      score
      rating
      ratingAmount
      user { id name avatar { large medium } }
    }
  }
`;

const MANGA_DETAIL_FRAGMENT = `
  id
  title { romaji english native }
  coverImage { extraLarge large medium color }
  bannerImage
  format
  status
  chapters
  volumes
  genres
  tags { id name rank isMediaSpoiler isGeneralSpoiler }
  averageScore
  popularity
  isAdult
  externalLinks { id url site type }
  startDate { year month day }
  endDate { year month day }
  description
  source
  meanScore
  favourites
  staff(sort: RELEVANCE, perPage: 15) {
    edges {
      id
      role
      node { id name { full } image { large medium } }
    }
  }
  recommendations(sort: RATING_DESC, perPage: 15) {
    nodes {
      id
      rating
      mediaRecommendation {
        id
        title { romaji english native }
        format
        coverImage { extraLarge large medium color }
        averageScore
        episodes
        seasonYear
        type
        chapters
        volumes
      }
    }
  }
  relations {
    edges {
      id
      relationType
      node {
        id
        title { romaji english native }
        format
        status
        coverImage { extraLarge large medium color }
        averageScore
        episodes
        seasonYear
        type
        chapters
        volumes
      }
    }
  }
  reviews(sort: RATING_DESC, perPage: 5) {
    nodes {
      id
      summary
      score
      rating
      ratingAmount
      user { id name avatar { large medium } }
    }
  }
`;

interface GqlResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

interface AiringMediaData {
  Media: {
    nextAiringEpisode: AniListNextAiringEpisode | null;
  } | null;
}

interface PageData {
  Page: {
    pageInfo: AniListPageInfo;
    media: AniListMedia[];
  };
}

interface MediaData {
  Media: AniListMediaDetail;
}

interface MangaMediaData {
  Media: AniListMangaDetail;
}

async function gqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  await rateLimitWait();

  const response = await axios.post<GqlResponse<T>>(
    ANILIST_ENDPOINT,
    { query, variables },
    {
      timeout: ANILIST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    }
  );

  if (response.data.errors?.length) {
    const messages = response.data.errors.map((error) => error.message).join('; ');
    throw new Error(`AniList API error: ${messages}`);
  }

  return response.data.data;
}

function getCachePolicy(type: 'sections' | 'browse' | 'detail' | 'airing'): AnilistCachePolicy {
  switch (type) {
    case 'sections':
      return { ttlSeconds: 5 * 60, staleSeconds: 30 * 60 };
    case 'airing':
      return { ttlSeconds: 10 * 60, staleSeconds: 30 * 60 };
    case 'detail':
      return { ttlSeconds: 24 * 60 * 60, staleSeconds: 7 * 24 * 60 * 60 };
    case 'browse':
    default:
      return { ttlSeconds: 10 * 60, staleSeconds: 60 * 60 };
  }
}

export async function searchAnime(
  query: string,
  page = 1,
  perPage = 20
): Promise<{ pageInfo: AniListPageInfo; media: AniListMedia[] }> {
  const gqlQuery = `
    query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(search: $search, type: ANIME, isAdult: false, sort: [SEARCH_MATCH]) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
    }
  `;

  const result = await getAnilistJsonWithCache<PageData>({
    endpoint: 'search',
    params: { search: query, page, perPage },
    policy: getCachePolicy('browse'),
    fetcher: () => gqlRequest<PageData>(gqlQuery, { search: query, page, perPage }),
  });

  return result.Page;
}

export async function getAnimeDetail(id: number): Promise<AniListMediaDetail> {
  const gqlQuery = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_DETAIL_FRAGMENT}
      }
    }
  `;

  const result = await getAnilistJsonWithCache<MediaData>({
    endpoint: 'detail',
    params: { id },
    policy: getCachePolicy('detail'),
    fetcher: () => gqlRequest<MediaData>(gqlQuery, { id }),
  });

  return result.Media;
}

export async function getAnimeNextAiringEpisode(id: number): Promise<AniListNextAiringEpisode | null> {
  const gqlQuery = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        nextAiringEpisode { airingAt episode }
      }
    }
  `;

  const result = await getAnilistJsonWithCache<AiringMediaData>({
    endpoint: 'airing',
    params: { id },
    policy: getCachePolicy('airing'),
    fetcher: () => gqlRequest<AiringMediaData>(gqlQuery, { id }),
  });

  return result.Media?.nextAiringEpisode ?? null;
}

export async function getMangaDetail(id: number): Promise<AniListMangaDetail> {
  const gqlQuery = `
    query ($id: Int) {
      Media(id: $id, type: MANGA) {
        ${MANGA_DETAIL_FRAGMENT}
      }
    }
  `;

  const result = await getAnilistJsonWithCache<MangaMediaData>({
    endpoint: 'mangaDetail',
    params: { id },
    policy: getCachePolicy('detail'),
    fetcher: () => gqlRequest<MangaMediaData>(gqlQuery, { id }),
  });

  return result.Media;
}

export async function getTopRated(
  page = 1,
  perPage = 20
): Promise<{ pageInfo: AniListPageInfo; media: AniListMedia[] }> {
  const gqlQuery = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, sort: [SCORE_DESC], isAdult: false, minimumTagRank: 0, popularity_greater: 5000) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
    }
  `;

  const result = await getAnilistJsonWithCache<PageData>({
    endpoint: 'topRated',
    params: { page, perPage },
    policy: getCachePolicy('sections'),
    fetcher: () => gqlRequest<PageData>(gqlQuery, { page, perPage }),
  });

  return result.Page;
}

export async function getPopular(
  page = 1,
  perPage = 20
): Promise<{ pageInfo: AniListPageInfo; media: AniListMedia[] }> {
  const gqlQuery = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, sort: [POPULARITY_DESC], isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
    }
  `;

  const result = await getAnilistJsonWithCache<PageData>({
    endpoint: 'popular',
    params: { page, perPage },
    policy: getCachePolicy('sections'),
    fetcher: () => gqlRequest<PageData>(gqlQuery, { page, perPage }),
  });

  return result.Page;
}

export async function getTrending(
  page = 1,
  perPage = 20
): Promise<{ pageInfo: AniListPageInfo; media: AniListMedia[] }> {
  const gqlQuery = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, sort: [TRENDING_DESC], isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
    }
  `;

  const result = await getAnilistJsonWithCache<PageData>({
    endpoint: 'trending',
    params: { page, perPage },
    policy: getCachePolicy('sections'),
    fetcher: () => gqlRequest<PageData>(gqlQuery, { page, perPage }),
  });

  return result.Page;
}

export async function getSeasonal(
  season: AniListMediaSeason,
  seasonYear: number,
  page = 1,
  perPage = 20
): Promise<{ pageInfo: AniListPageInfo; media: AniListMedia[] }> {
  const gqlQuery = `
    query ($season: MediaSeason, $seasonYear: Int, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: [POPULARITY_DESC], isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
    }
  `;

  const result = await getAnilistJsonWithCache<PageData>({
    endpoint: 'seasonal',
    params: { season, seasonYear, page, perPage },
    policy: getCachePolicy('sections'),
    fetcher: () => gqlRequest<PageData>(gqlQuery, { season, seasonYear, page, perPage }),
  });

  return result.Page;
}

function mapSortToAniList(sort: AnimeBrowseSort): AniListSort {
  switch (sort) {
    case 'seasonal':
    case 'popularity':
      return 'POPULARITY_DESC';
    case 'trending': return 'TRENDING_DESC';
    case 'score': return 'SCORE_DESC';
    case 'newest': return 'START_DATE_DESC';
    case 'title': return 'TITLE_ROMAJI';
    case 'favourites': return 'FAVOURITES_DESC';
    case 'date_added': return 'ID_DESC';
    case 'release_date': return 'START_DATE_DESC';
    default: return 'TRENDING_DESC';
  }
}

export async function browseAnime(params: {
  page?: number;
  perPage?: number;
  sort?: AnimeBrowseSort;
  genres?: string[];
  year?: number;
  yearLesser?: number;
  yearGreater?: number;
  season?: AniListMediaSeason;
  format?: AniListMediaFormat[];
  status?: AniListMediaStatus;
}): Promise<{ pageInfo: AniListPageInfo; media: AniListMedia[] }> {
  const currentSeason = getCurrentSeason();
  const sort = params.sort ?? 'seasonal';
  const season = params.season ?? (sort === 'seasonal' ? currentSeason.season : undefined);
  const seasonYear = params.year ?? (sort === 'seasonal' ? currentSeason.year : undefined);

  const variables: Record<string, unknown> = {
    page: params.page ?? 1,
    perPage: params.perPage ?? 20,
    sort: [mapSortToAniList(sort)],
    isAdult: false,
  };

  const conditions: string[] = [
    '$page: Int',
    '$perPage: Int',
    '$sort: [MediaSort]',
    '$isAdult: Boolean',
  ];
  const mediaArgs: string[] = [
    'type: ANIME',
    'sort: $sort',
    'isAdult: $isAdult',
  ];

  if (params.genres?.length) {
    conditions.push('$genre_in: [String]');
    mediaArgs.push('genre_in: $genre_in');
    variables.genre_in = params.genres;
  }
  if (seasonYear) {
    conditions.push('$seasonYear: Int');
    mediaArgs.push('seasonYear: $seasonYear');
    variables.seasonYear = seasonYear;
  }
  if (params.yearLesser) {
    conditions.push('$startDate_lesser: FuzzyDateInt');
    mediaArgs.push('startDate_lesser: $startDate_lesser');
    variables.startDate_lesser = params.yearLesser * 10000 + 1231; // End of year
  }
  if (params.yearGreater) {
    conditions.push('$startDate_greater: FuzzyDateInt');
    mediaArgs.push('startDate_greater: $startDate_greater');
    variables.startDate_greater = params.yearGreater * 10000; // Start of year
  }
  if (season) {
    conditions.push('$season: MediaSeason');
    mediaArgs.push('season: $season');
    variables.season = season;
  }
  if (params.format?.length) {
    conditions.push('$format_in: [MediaFormat]');
    mediaArgs.push('format_in: $format_in');
    variables.format_in = params.format;
  }
  if (params.status) {
    conditions.push('$status: MediaStatus');
    mediaArgs.push('status: $status');
    variables.status = params.status;
  }

  const gqlQuery = `
    query (${conditions.join(', ')}) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(${mediaArgs.join(', ')}) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
    }
  `;

  const result = await getAnilistJsonWithCache<PageData>({
    endpoint: 'browse',
    params: variables,
    policy: getCachePolicy('browse'),
    fetcher: () => gqlRequest<PageData>(gqlQuery, variables),
  });

  return result.Page;
}

export interface AnimeHomeData {
  trending: AniListMedia[];
  season: AniListMedia[];
  nextSeason: AniListMedia[];
  popular: AniListMedia[];
  top: AniListMedia[];
}

export async function getAnimeHome(
  season: AniListMediaSeason,
  seasonYear: number,
  nextSeason: AniListMediaSeason,
  nextYear: number
): Promise<AnimeHomeData> {
  const gqlQuery = `
    query($season: MediaSeason, $seasonYear: Int, $nextSeason: MediaSeason, $nextYear: Int) {
      trending: Page(page: 1, perPage: 10) {
        media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
      season: Page(page: 1, perPage: 10) {
        media(season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
      nextSeason: Page(page: 1, perPage: 10) {
        media(season: $nextSeason, seasonYear: $nextYear, sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
      popular: Page(page: 1, perPage: 10) {
        media(sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
      top: Page(page: 1, perPage: 10) {
        media(sort: SCORE_DESC, type: ANIME, isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
    }
  `;

  const variables = { season, seasonYear, nextSeason, nextYear };

  interface HomeResponse {
    trending: { media: AniListMedia[] };
    season: { media: AniListMedia[] };
    nextSeason: { media: AniListMedia[] };
    popular: { media: AniListMedia[] };
    top: { media: AniListMedia[] };
  }

  const result = await getAnilistJsonWithCache<HomeResponse>({
    endpoint: 'home',
    params: variables,
    policy: getCachePolicy('sections'),
    fetcher: () => gqlRequest<HomeResponse>(gqlQuery, variables),
  });

  return {
    trending: result.trending.media,
    season: result.season.media,
    nextSeason: result.nextSeason.media,
    popular: result.popular.media,
    top: result.top.media,
  };
}
