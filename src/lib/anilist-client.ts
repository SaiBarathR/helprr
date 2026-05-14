import axios from 'axios';
import type {
  AniListAiringSchedule,
  AniListMedia,
  AniListMediaDetail,
  AniListMangaDetail,
  AniListMediaFormat,
  AniListNextAiringEpisode,
  AniListMediaSeason,
  AniListMediaStatus,
  AniListMediaType,
  AniListPageInfo,
  AniListSort,
  AniListStaffDetailResponse,
  AniListStaffMediaEdge,
  AniListStaffVoiceActingEdge,
  AniListCharacterDetailResponse,
  AniListStudioDetailResponse,
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

export async function rateLimitWait(): Promise<void> {
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

export const MEDIA_LIST_FRAGMENT = `
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

interface AiringSchedulePageData {
  Page: {
    pageInfo: AniListPageInfo;
    airingSchedules: AniListAiringSchedule[];
  };
}

const SCHEDULE_PAGE_LIMIT = 10;
const SCHEDULE_PER_PAGE = 50;

export async function getAnimeAiringSchedule(params: {
  weekStart: number;
  weekEnd: number;
}): Promise<AniListAiringSchedule[]> {
  const gqlQuery = `
    query ($weekStart: Int, $weekEnd: Int, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage currentPage }
        airingSchedules(
          airingAt_greater: $weekStart
          airingAt_lesser: $weekEnd
          sort: TIME
        ) {
          id
          episode
          airingAt
          media {
            id
            title { romaji english native }
            coverImage { extraLarge large medium color }
            format
            status
            season
            seasonYear
            episodes
            averageScore
            isAdult
            genres
            studios(isMain: true) { nodes { id name } }
          }
        }
      }
    }
  `;

  const fetchAllPages = async (): Promise<AniListAiringSchedule[]> => {
    const collected: AniListAiringSchedule[] = [];
    for (let page = 1; page <= SCHEDULE_PAGE_LIMIT; page += 1) {
      const variables = {
        weekStart: params.weekStart,
        weekEnd: params.weekEnd,
        page,
        perPage: SCHEDULE_PER_PAGE,
      };
      const result = await gqlRequest<AiringSchedulePageData>(gqlQuery, variables);
      const schedules = result.Page?.airingSchedules ?? [];
      collected.push(...schedules);
      if (!result.Page?.pageInfo?.hasNextPage) break;
    }
    return collected;
  };

  return getAnilistJsonWithCache<AniListAiringSchedule[]>({
    endpoint: 'airingSchedule',
    params: { weekStart: params.weekStart, weekEnd: params.weekEnd },
    policy: getCachePolicy('airing'),
    fetcher: fetchAllPages,
  });
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
  nextYear: number,
  perPage = 10
): Promise<AnimeHomeData> {
  const gqlQuery = `
    query($season: MediaSeason, $seasonYear: Int, $nextSeason: MediaSeason, $nextYear: Int, $perPage: Int) {
      trending: Page(page: 1, perPage: $perPage) {
        media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
      season: Page(page: 1, perPage: $perPage) {
        media(season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
      nextSeason: Page(page: 1, perPage: $perPage) {
        media(season: $nextSeason, seasonYear: $nextYear, sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
      popular: Page(page: 1, perPage: $perPage) {
        media(sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
      top: Page(page: 1, perPage: $perPage) {
        media(sort: SCORE_DESC, type: ANIME, isAdult: false) {
          ${MEDIA_LIST_FRAGMENT}
        }
      }
    }
  `;

  const variables = { season, seasonYear, nextSeason, nextYear, perPage };

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

// --- Staff Detail ---

const STAFF_MEDIA_NODE_FRAGMENT = `
  id
  title { romaji english native }
  coverImage { extraLarge large medium color }
  format
  type
  averageScore
  popularity
  favourites
  seasonYear
  startDate { year month day }
  episodes
  chapters
`;

interface StaffMediaEdgeRaw {
  staffRole: string;
  node: {
    id: number;
    title: { romaji: string | null; english: string | null; native: string | null };
    coverImage: { extraLarge: string | null; large: string | null; medium: string | null; color: string | null };
    format: AniListMediaFormat | null;
    type: AniListMediaType | null;
    averageScore: number | null;
    popularity: number | null;
    favourites: number | null;
    seasonYear: number | null;
    startDate: { year: number | null; month: number | null; day: number | null } | null;
    episodes: number | null;
    chapters: number | null;
  };
}

interface StaffCharacterMediaEdgeRaw {
  characterRole: string | null;
  characterName: string | null;
  node: StaffMediaEdgeRaw['node'];
  characters: Array<{
    id: number;
    name: { full: string | null };
    image: { large: string | null; medium: string | null } | null;
  }> | null;
}

function normalizeStaffMediaEdge(e: StaffMediaEdgeRaw): AniListStaffMediaEdge {
  return {
    staffRole: e.staffRole,
    node: {
      id: e.node.id,
      title: e.node.title.english || e.node.title.romaji || e.node.title.native || 'Unknown',
      coverImage: e.node.coverImage.extraLarge || e.node.coverImage.large || null,
      format: e.node.format,
      type: e.node.type,
      averageScore: e.node.averageScore,
      popularity: e.node.popularity,
      favourites: e.node.favourites,
      seasonYear: e.node.seasonYear,
      startDate: e.node.startDate ?? null,
      episodes: e.node.episodes,
      chapters: e.node.chapters,
    },
  };
}

function normalizeStaffCharacterMediaEdge(e: StaffCharacterMediaEdgeRaw): AniListStaffVoiceActingEdge {
  return {
    characterRole: e.characterRole ?? '',
    characterName: e.characterName ?? null,
    characters: (e.characters ?? []).map((c) => ({
      id: c.id,
      name: c.name.full || '',
      image: c.image?.large || c.image?.medium || null,
    })),
    node: {
      id: e.node.id,
      title: e.node.title.english || e.node.title.romaji || e.node.title.native || 'Unknown',
      coverImage: e.node.coverImage.extraLarge || e.node.coverImage.large || null,
      format: e.node.format,
      type: e.node.type,
      averageScore: e.node.averageScore,
      popularity: e.node.popularity,
      favourites: e.node.favourites,
      seasonYear: e.node.seasonYear,
      startDate: e.node.startDate ?? null,
      episodes: e.node.episodes,
      chapters: e.node.chapters,
    },
  };
}

export async function getStaffDetail(
  id: number,
  animePage = 1,
  mangaPage = 1,
  vaPage = 1,
  animeSort: AniListSort = 'POPULARITY_DESC',
  mangaSort: AniListSort = 'POPULARITY_DESC',
  vaSort: AniListSort = 'POPULARITY_DESC',
  perPage = 25
): Promise<AniListStaffDetailResponse> {
  const gqlQuery = `
    query ($id: Int, $animePage: Int, $mangaPage: Int, $vaPage: Int, $perPage: Int, $animeSort: [MediaSort], $mangaSort: [MediaSort], $vaSort: [MediaSort]) {
      Staff(id: $id) {
        id
        name { full native alternative }
        image { large medium }
        description(asHtml: true)
        primaryOccupations
        gender
        dateOfBirth { year month day }
        dateOfDeath { year month day }
        age
        yearsActive
        homeTown
        bloodType
        languageV2
        favourites
        siteUrl
        staffMedia(page: $animePage, perPage: $perPage, type: ANIME, sort: $animeSort) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          edges {
            staffRole
            node { ${STAFF_MEDIA_NODE_FRAGMENT} }
          }
        }
        mangaMedia: staffMedia(page: $mangaPage, perPage: $perPage, type: MANGA, sort: $mangaSort) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          edges {
            staffRole
            node { ${STAFF_MEDIA_NODE_FRAGMENT} }
          }
        }
        characterMedia(page: $vaPage, perPage: $perPage, sort: $vaSort) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          edges {
            characterRole
            characterName
            node { ${STAFF_MEDIA_NODE_FRAGMENT} }
            characters {
              id
              name { full }
              image { large medium }
            }
          }
        }
      }
    }
  `;

  interface StaffResponse {
    Staff: {
      id: number;
      name: { full: string | null; native: string | null; alternative: string[] | null };
      image: { large: string | null; medium: string | null };
      description: string | null;
      primaryOccupations: string[] | null;
      gender: string | null;
      dateOfBirth: { year: number | null; month: number | null; day: number | null } | null;
      dateOfDeath: { year: number | null; month: number | null; day: number | null } | null;
      age: number | null;
      yearsActive: number[] | null;
      homeTown: string | null;
      bloodType: string | null;
      languageV2: string | null;
      favourites: number | null;
      siteUrl: string | null;
      staffMedia: {
        pageInfo: AniListPageInfo;
        edges: StaffMediaEdgeRaw[];
      };
      mangaMedia: {
        pageInfo: AniListPageInfo;
        edges: StaffMediaEdgeRaw[];
      };
      characterMedia: {
        pageInfo: AniListPageInfo;
        edges: StaffCharacterMediaEdgeRaw[];
      };
    } | null;
  }

  const variables = { id, animePage, mangaPage, vaPage, perPage, animeSort: [animeSort], mangaSort: [mangaSort], vaSort: [vaSort] };

  const result = await getAnilistJsonWithCache<StaffResponse>({
    endpoint: 'staffDetail',
    params: variables,
    policy: getCachePolicy('detail'),
    fetcher: () => gqlRequest<StaffResponse>(gqlQuery, variables),
  });

  const s = result.Staff;
  if (!s) throw new Error('Staff not found');

  return {
    id: s.id,
    name: s.name.full || 'Unknown',
    nameNative: s.name.native,
    nameAlternative: s.name.alternative ?? [],
    image: s.image.large || s.image.medium || null,
    description: s.description,
    primaryOccupations: s.primaryOccupations ?? [],
    gender: s.gender,
    dateOfBirth: s.dateOfBirth ?? null,
    dateOfDeath: s.dateOfDeath ?? null,
    age: s.age,
    yearsActive: s.yearsActive ?? [],
    homeTown: s.homeTown,
    bloodType: s.bloodType,
    languageV2: s.languageV2,
    favourites: s.favourites,
    siteUrl: s.siteUrl,
    animeMedia: s.staffMedia.edges.map(normalizeStaffMediaEdge),
    animePageInfo: s.staffMedia.pageInfo,
    mangaMedia: s.mangaMedia.edges.map(normalizeStaffMediaEdge),
    mangaPageInfo: s.mangaMedia.pageInfo,
    voiceActingMedia: s.characterMedia.edges.map(normalizeStaffCharacterMediaEdge),
    voiceActingPageInfo: s.characterMedia.pageInfo,
  };
}

export async function getStaffMediaPage(
  id: number,
  type: 'ANIME' | 'MANGA',
  page: number,
  sort: AniListSort = 'POPULARITY_DESC',
  perPage = 25
): Promise<{ pageInfo: AniListPageInfo; edges: AniListStaffMediaEdge[] }> {
  const gqlQuery = `
    query ($id: Int, $page: Int, $perPage: Int, $sort: [MediaSort], $type: MediaType) {
      Staff(id: $id) {
        staffMedia(page: $page, perPage: $perPage, type: $type, sort: $sort) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          edges {
            staffRole
            node { ${STAFF_MEDIA_NODE_FRAGMENT} }
          }
        }
      }
    }
  `;

  interface StaffPageResponse {
    Staff: {
      staffMedia: {
        pageInfo: AniListPageInfo;
        edges: StaffMediaEdgeRaw[];
      };
    } | null;
  }

  const variables = { id, page, perPage, sort: [sort], type };
  const result = await getAnilistJsonWithCache<StaffPageResponse>({
    endpoint: 'staffMediaPage',
    params: variables,
    policy: getCachePolicy('detail'),
    fetcher: () => gqlRequest<StaffPageResponse>(gqlQuery, variables),
  });

  if (!result.Staff) throw new Error('Staff not found');

  return {
    pageInfo: result.Staff.staffMedia.pageInfo,
    edges: result.Staff.staffMedia.edges.map(normalizeStaffMediaEdge),
  };
}

export async function getStaffCharacterMediaPage(
  id: number,
  page: number,
  sort: AniListSort = 'POPULARITY_DESC',
  perPage = 25
): Promise<{ pageInfo: AniListPageInfo; edges: AniListStaffVoiceActingEdge[] }> {
  const gqlQuery = `
    query ($id: Int, $page: Int, $perPage: Int, $sort: [MediaSort]) {
      Staff(id: $id) {
        characterMedia(page: $page, perPage: $perPage, sort: $sort) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          edges {
            characterRole
            characterName
            node { ${STAFF_MEDIA_NODE_FRAGMENT} }
            characters {
              id
              name { full }
              image { large medium }
            }
          }
        }
      }
    }
  `;

  interface StaffCharacterMediaPageResponse {
    Staff: {
      characterMedia: {
        pageInfo: AniListPageInfo;
        edges: StaffCharacterMediaEdgeRaw[];
      };
    } | null;
  }

  const variables = { id, page, perPage, sort: [sort] };
  const result = await getAnilistJsonWithCache<StaffCharacterMediaPageResponse>({
    endpoint: 'staffCharacterMediaPage',
    params: variables,
    policy: getCachePolicy('detail'),
    fetcher: () => gqlRequest<StaffCharacterMediaPageResponse>(gqlQuery, variables),
  });

  if (!result.Staff) throw new Error('Staff not found');

  return {
    pageInfo: result.Staff.characterMedia.pageInfo,
    edges: result.Staff.characterMedia.edges.map(normalizeStaffCharacterMediaEdge),
  };
}

// --- Character Detail ---

export async function getCharacterDetail(
  id: number,
  page = 1,
  sort: AniListSort = 'POPULARITY_DESC',
  perPage = 25
): Promise<AniListCharacterDetailResponse> {
  const gqlQuery = `
    query ($id: Int, $page: Int, $perPage: Int, $sort: [MediaSort]) {
      Character(id: $id) {
        id
        name { full native alternative alternativeSpoiler }
        image { large medium }
        description(asHtml: true)
        gender
        dateOfBirth { year month day }
        age
        bloodType
        favourites
        siteUrl
        media(page: $page, perPage: $perPage, sort: $sort) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          edges {
            characterRole
            voiceActors(language: JAPANESE) {
              id
              name { full }
              image { large medium }
              language
            }
            node {
              id
              title { romaji english native }
              coverImage { extraLarge large medium color }
              format
              type
              averageScore
              popularity
              favourites
              seasonYear
              startDate { year month day }
              episodes
              chapters
            }
          }
        }
      }
    }
  `;

  interface CharacterEdgeRaw {
    characterRole: string;
    voiceActors: Array<{
      id: number;
      name: { full: string | null };
      image: { large: string | null; medium: string | null };
      language: string | null;
    }>;
    node: {
      id: number;
      title: { romaji: string | null; english: string | null; native: string | null };
      coverImage: { extraLarge: string | null; large: string | null; medium: string | null; color: string | null };
      format: AniListMediaFormat | null;
      type: AniListMediaType | null;
      averageScore: number | null;
      popularity: number | null;
      favourites: number | null;
      seasonYear: number | null;
      startDate: { year: number | null; month: number | null; day: number | null } | null;
      episodes: number | null;
      chapters: number | null;
    };
  }

  interface CharacterResponse {
    Character: {
      id: number;
      name: { full: string | null; native: string | null; alternative: string[] | null; alternativeSpoiler: string[] | null };
      image: { large: string | null; medium: string | null };
      description: string | null;
      gender: string | null;
      dateOfBirth: { year: number | null; month: number | null; day: number | null } | null;
      age: string | null;
      bloodType: string | null;
      favourites: number | null;
      siteUrl: string | null;
      media: {
        pageInfo: AniListPageInfo;
        edges: CharacterEdgeRaw[];
      };
    } | null;
  }

  const variables = { id, page, perPage, sort: [sort] };

  const result = await getAnilistJsonWithCache<CharacterResponse>({
    endpoint: 'characterDetail',
    params: variables,
    policy: getCachePolicy('detail'),
    fetcher: () => gqlRequest<CharacterResponse>(gqlQuery, variables),
  });

  const c = result.Character;
  if (!c) throw new Error('Character not found');

  return {
    id: c.id,
    name: c.name.full || 'Unknown',
    nameNative: c.name.native,
    nameAlternative: c.name.alternative ?? [],
    nameSpoiler: c.name.alternativeSpoiler ?? [],
    image: c.image.large || c.image.medium || null,
    description: c.description,
    gender: c.gender,
    dateOfBirth: c.dateOfBirth ?? null,
    age: c.age,
    bloodType: c.bloodType,
    favourites: c.favourites,
    siteUrl: c.siteUrl,
    media: c.media.edges.map((e) => ({
      characterRole: e.characterRole,
      voiceActors: e.voiceActors.map((va) => ({
        id: va.id,
        name: va.name.full || '',
        image: va.image.large || va.image.medium || null,
        language: va.language,
      })),
      node: {
        id: e.node.id,
        title: e.node.title.english || e.node.title.romaji || e.node.title.native || 'Unknown',
        coverImage: e.node.coverImage.extraLarge || e.node.coverImage.large || null,
        format: e.node.format,
        type: e.node.type,
        averageScore: e.node.averageScore,
        popularity: e.node.popularity,
        favourites: e.node.favourites,
        seasonYear: e.node.seasonYear,
        startDate: e.node.startDate ?? null,
        episodes: e.node.episodes,
        chapters: e.node.chapters,
      },
    })),
    mediaPageInfo: c.media.pageInfo,
  };
}

// --- Studio Detail ---

export async function getStudioDetail(
  id: number,
  page = 1,
  sort: AniListSort = 'START_DATE_DESC',
  perPage = 25
): Promise<AniListStudioDetailResponse> {
  const gqlQuery = `
    query ($id: Int, $page: Int, $perPage: Int, $sort: [MediaSort]) {
      Studio(id: $id) {
        id
        name
        isAnimationStudio
        favourites
        siteUrl
        media(page: $page, perPage: $perPage, sort: $sort) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          edges {
            isMainStudio
            node {
              id
              title { romaji english native }
              coverImage { extraLarge large medium color }
              format
              type
              averageScore
              popularity
              favourites
              seasonYear
              startDate { year month day }
              episodes
              chapters
              status
              season
              nextAiringEpisode { airingAt episode }
              genres
            }
          }
        }
      }
    }
  `;

  interface StudioEdgeRaw {
    isMainStudio: boolean;
    node: {
      id: number;
      title: { romaji: string | null; english: string | null; native: string | null };
      coverImage: { extraLarge: string | null; large: string | null; medium: string | null; color: string | null };
      format: AniListMediaFormat | null;
      type: AniListMediaType | null;
      averageScore: number | null;
      popularity: number | null;
      favourites: number | null;
      seasonYear: number | null;
      startDate: { year: number | null; month: number | null; day: number | null } | null;
      episodes: number | null;
      chapters: number | null;
      status: AniListMediaStatus | null;
      season: AniListMediaSeason | null;
      nextAiringEpisode: { airingAt: number; episode: number } | null;
      genres: string[];
    };
  }

  interface StudioResponse {
    Studio: {
      id: number;
      name: string;
      isAnimationStudio: boolean;
      favourites: number | null;
      siteUrl: string | null;
      media: {
        pageInfo: AniListPageInfo;
        edges: StudioEdgeRaw[];
      };
    } | null;
  }

  const variables = { id, page, perPage, sort: [sort] };

  const result = await getAnilistJsonWithCache<StudioResponse>({
    endpoint: 'studioDetail.v2',
    params: variables,
    policy: getCachePolicy('detail'),
    fetcher: () => gqlRequest<StudioResponse>(gqlQuery, variables),
  });

  const st = result.Studio;
  if (!st) throw new Error('Studio not found');

  // AniList can return the same media twice when a studio has multiple roles
  // (e.g., main + producer). Collapse by node id, preferring the main-studio edge.
  const seen = new Map<number, StudioEdgeRaw>();
  for (const edge of st.media.edges) {
    const existing = seen.get(edge.node.id);
    if (!existing || (!existing.isMainStudio && edge.isMainStudio)) {
      seen.set(edge.node.id, edge);
    }
  }

  return {
    id: st.id,
    name: st.name,
    isAnimationStudio: st.isAnimationStudio,
    favourites: st.favourites,
    siteUrl: st.siteUrl,
    media: Array.from(seen.values()).map(({ node: n }) => ({
      id: n.id,
      title: n.title.english || n.title.romaji || n.title.native || 'Unknown',
      coverImage: n.coverImage.extraLarge || n.coverImage.large || null,
      format: n.format,
      type: n.type,
      averageScore: n.averageScore,
      popularity: n.popularity,
      favourites: n.favourites,
      seasonYear: n.seasonYear,
      startDate: n.startDate ?? null,
      episodes: n.episodes,
      chapters: n.chapters,
      status: n.status,
      season: n.season,
      nextAiringEpisode: n.nextAiringEpisode,
      genres: n.genres || [],
    })),
    mediaPageInfo: st.media.pageInfo,
  };
}
