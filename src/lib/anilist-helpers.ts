import type {
  AniListMedia,
  AniListMediaDetail,
  AniListMangaDetail,
  AniListMediaFormat,
  AniListMediaSeason,
  AniListListItem,
  AniListDetailResponse,
  AniListMangaDetailResponse,
  AniListExternalLink,
  AniListRanking,
} from '@/types/anilist';

/**
 * AniList formats that are valid links for a Sonarr series (no movies/manga).
 * Shared single source for the server-side auto-matcher and the remap drawer.
 */
export const ACCEPTABLE_SERIES_FORMATS = new Set(['TV', 'TV_SHORT', 'OVA', 'ONA', 'SPECIAL']);

export function getPreferredTitle(title: { romaji: string | null; english: string | null; native: string | null }): string {
  return title.english || title.romaji || title.native || 'Unknown';
}

function getMainStudios(media: AniListMedia): string[] {
  if (!media.studios?.edges) return [];
  return media.studios.edges
    .filter((e) => e.isMain)
    .map((e) => e.node.name);
}

function getYear(media: AniListMedia): number | null {
  return media.seasonYear ?? media.startDate?.year ?? null;
}

export function normalizeAniListItem(media: AniListMedia): AniListListItem {
  return {
    id: media.id,
    title: getPreferredTitle(media.title),
    titleRomaji: media.title.romaji,
    titleNative: media.title.native,
    coverImage: media.coverImage.extraLarge || media.coverImage.large || null,
    bannerImage: media.bannerImage,
    format: media.format,
    status: media.status,
    season: media.season,
    seasonYear: media.seasonYear,
    episodes: media.episodes,
    duration: media.duration,
    genres: media.genres || [],
    averageScore: media.averageScore,
    popularity: media.popularity,
    trending: media.trending,
    isAdult: media.isAdult,
    studios: getMainStudios(media),
    year: getYear(media),
    coverImageColor: media.coverImage.color,
  };
}

export function normalizeAniListDetail(media: AniListMediaDetail): AniListDetailResponse {
  const title = getPreferredTitle(media.title);

  const characters = (media.characters?.edges || []).map((edge) => {
    const japaneseVA = edge.voiceActors?.[0] ?? null;
    return {
      id: edge.node.id,
      name: edge.node.name.full || '',
      image: edge.node.image.large || null,
      role: edge.role,
      voiceActor: japaneseVA ? {
        id: japaneseVA.id,
        name: japaneseVA.name.full || '',
        image: japaneseVA.image.large || null,
        language: japaneseVA.language,
      } : null,
    };
  });

  const staff = (media.staff?.edges || []).map((edge) => ({
    id: edge.node.id,
    name: edge.node.name.full || '',
    image: edge.node.image.large || null,
    role: edge.role,
  }));

  const relations = (media.relations?.edges || []).map((edge) => ({
    id: edge.node.id,
    title: getPreferredTitle(edge.node.title),
    coverImage: edge.node.coverImage.extraLarge || edge.node.coverImage.large || null,
    format: edge.node.format,
    status: edge.node.status,
    relationType: edge.relationType,
    averageScore: edge.node.averageScore,
    episodes: edge.node.episodes,
    seasonYear: edge.node.seasonYear,
    type: edge.node.type ?? null,
    chapters: edge.node.chapters ?? null,
    volumes: edge.node.volumes ?? null,
  }));

  const recommendations = (media.recommendations?.nodes || [])
    .filter((n) => n.mediaRecommendation)
    .map((n) => ({
      id: n.mediaRecommendation!.id,
      title: getPreferredTitle(n.mediaRecommendation!.title),
      coverImage: n.mediaRecommendation!.coverImage.extraLarge || n.mediaRecommendation!.coverImage.large || null,
      format: n.mediaRecommendation!.format,
      averageScore: n.mediaRecommendation!.averageScore,
      episodes: n.mediaRecommendation!.episodes,
      seasonYear: n.mediaRecommendation!.seasonYear,
      rating: n.rating,
      type: n.mediaRecommendation!.type ?? null,
      chapters: n.mediaRecommendation!.chapters ?? null,
      volumes: n.mediaRecommendation!.volumes ?? null,
    }));

  const reviews = media.reviews?.nodes || [];

  const tags = (media.tags || []).map((t) => ({
    name: t.name,
    rank: t.rank,
    isSpoiler: t.isMediaSpoiler || t.isGeneralSpoiler,
  }));

  const studios = (media.studios?.edges || []).map((e) => ({
    id: e.node.id,
    name: e.node.name,
    isMain: e.isMain,
  }));

  return {
    id: media.id,
    title,
    titleRomaji: media.title.romaji,
    titleNative: media.title.native,
    description: media.description,
    coverImage: media.coverImage.extraLarge || media.coverImage.large || null,
    bannerImage: media.bannerImage,
    format: media.format,
    status: media.status,
    season: media.season,
    seasonYear: media.seasonYear,
    episodes: media.episodes,
    duration: media.duration,
    genres: media.genres || [],
    tags,
    averageScore: media.averageScore,
    meanScore: media.meanScore,
    popularity: media.popularity,
    favourites: media.favourites,
    isAdult: media.isAdult,
    source: media.source,
    hashtag: media.hashtag ?? null,
    startDate: media.startDate ?? null,
    endDate: media.endDate ?? null,
    synonyms: media.synonyms ?? [],
    nextAiringEpisode: media.nextAiringEpisode ?? null,
    statusDistribution: media.stats?.statusDistribution ?? [],
    scoreDistribution: media.stats?.scoreDistribution ?? [],
    rankings: media.rankings ?? [],
    trailer: media.trailer ?? extractYouTubeTrailerFallback(media.externalLinks || []),
    studios,
    characters,
    staff,
    relations,
    recommendations,
    reviews,
    externalLinks: media.externalLinks || [],
    tvdbId: extractTvdbId(media.externalLinks || []),
    malId: extractMalId(media.externalLinks || []),
    tmdbId: extractTmdbId(media.externalLinks || []),
    year: getYear(media),
  };
}

export function normalizeAniListMangaDetail(media: AniListMangaDetail): AniListMangaDetailResponse {
  const title = getPreferredTitle(media.title);

  const staff = (media.staff?.edges || []).map((edge) => ({
    id: edge.node.id,
    name: edge.node.name.full || '',
    image: edge.node.image.large || null,
    role: edge.role,
  }));

  const relations = (media.relations?.edges || []).map((edge) => ({
    id: edge.node.id,
    title: getPreferredTitle(edge.node.title),
    coverImage: edge.node.coverImage.extraLarge || edge.node.coverImage.large || null,
    format: edge.node.format,
    status: edge.node.status,
    relationType: edge.relationType,
    averageScore: edge.node.averageScore,
    episodes: edge.node.episodes,
    seasonYear: edge.node.seasonYear,
    type: edge.node.type ?? null,
    chapters: edge.node.chapters ?? null,
    volumes: edge.node.volumes ?? null,
  }));

  const recommendations = (media.recommendations?.nodes || [])
    .filter((n) => n.mediaRecommendation)
    .map((n) => ({
      id: n.mediaRecommendation!.id,
      title: getPreferredTitle(n.mediaRecommendation!.title),
      coverImage: n.mediaRecommendation!.coverImage.extraLarge || n.mediaRecommendation!.coverImage.large || null,
      format: n.mediaRecommendation!.format,
      averageScore: n.mediaRecommendation!.averageScore,
      episodes: n.mediaRecommendation!.episodes,
      seasonYear: n.mediaRecommendation!.seasonYear,
      rating: n.rating,
      type: n.mediaRecommendation!.type ?? null,
      chapters: n.mediaRecommendation!.chapters ?? null,
      volumes: n.mediaRecommendation!.volumes ?? null,
    }));

  const reviews = media.reviews?.nodes || [];

  const tags = (media.tags || []).map((t) => ({
    name: t.name,
    rank: t.rank,
    isSpoiler: t.isMediaSpoiler || t.isGeneralSpoiler,
  }));

  return {
    id: media.id,
    title,
    titleRomaji: media.title.romaji,
    titleNative: media.title.native,
    description: media.description,
    coverImage: media.coverImage.extraLarge || media.coverImage.large || null,
    bannerImage: media.bannerImage,
    format: media.format,
    status: media.status,
    chapters: media.chapters ?? null,
    volumes: media.volumes ?? null,
    genres: media.genres || [],
    tags,
    averageScore: media.averageScore,
    meanScore: media.meanScore,
    popularity: media.popularity,
    favourites: media.favourites,
    isAdult: media.isAdult,
    source: media.source,
    startDate: media.startDate ?? null,
    endDate: media.endDate ?? null,
    staff,
    relations,
    recommendations,
    reviews,
    externalLinks: media.externalLinks || [],
  };
}

function normalizeFormatLabel(format: string | null | undefined): string | null {
  if (!format) return null;
  return format.replace(/_/g, ' ');
}

function rankingTypeLabel(type: AniListRanking['type'], fallbackContext?: string | null): string {
  if (type === 'RATED') return 'highest rated';
  if (type === 'POPULAR') return 'most popular';
  return fallbackContext?.toLowerCase().trim() || 'ranked';
}

export function formatAniListRankingLabel(ranking: AniListRanking): string {
  const base = rankingTypeLabel(ranking.type, ranking.context);

  if (ranking.allTime) {
    return `${base} all time`;
  }

  const formatLabel = normalizeFormatLabel(ranking.format);
  const shouldIncludeFormat = formatLabel && formatLabel !== 'TV';
  const seasonLabel = ranking.season ? ranking.season.toLowerCase() : null;
  const yearLabel = ranking.year ? String(ranking.year) : null;
  const scope = [
    shouldIncludeFormat ? formatLabel : null,
    seasonLabel,
    yearLabel,
  ].filter((part): part is string => Boolean(part)).join(' ');

  return scope ? `${base} ${scope}` : base;
}

export function formatFuzzyDate(date: { year?: number | null; month?: number | null; day?: number | null } | null): string | null {
  if (!date || !date.year) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (date.month && date.day) return `${months[date.month - 1]} ${date.day}, ${date.year}`;
  if (date.month) return `${months[date.month - 1]} ${date.year}`;
  return String(date.year);
}

export function formatFavourites(n: number | null): string {
  if (n == null) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
}

function matchYouTubeVideoId(url: string): string | null {
  if (url.includes('/playlist') || url.includes('/channel') || url.includes('/@') || url.includes('/c/')) return null;
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  return null;
}

export function extractYouTubeTrailerFallback(
  externalLinks: AniListExternalLink[]
): { id: string; site: string; thumbnail: string | null } | null {
  for (const link of externalLinks) {
    if (!link.url) continue;
    if (link.site !== 'YouTube' && !link.url.includes('youtube.com') && !link.url.includes('youtu.be')) continue;
    const id = matchYouTubeVideoId(link.url);
    if (id) return { id, site: 'youtube', thumbnail: null };
  }
  return null;
}

export function extractYouTubeVideosFromExternalLinks(
  externalLinks: AniListExternalLink[]
): { id: string; site: 'youtube' }[] {
  const seen = new Set<string>();
  const results: { id: string; site: 'youtube' }[] = [];
  for (const link of externalLinks) {
    if (!link.url) continue;
    if (link.site !== 'YouTube' && !link.url.includes('youtube.com') && !link.url.includes('youtu.be')) continue;
    const id = matchYouTubeVideoId(link.url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    results.push({ id, site: 'youtube' });
  }
  return results;
}

export function extractTvdbId(externalLinks: AniListExternalLink[]): number | null {
  for (const link of externalLinks) {
    if (!link.url) continue;
    try {
      const url = new URL(link.url);
      if (!/(^|\.)thetvdb\.com$/i.test(url.hostname)) continue;

      const queryId = url.searchParams.get('id');
      if (queryId && /^[1-9]\d*$/.test(queryId)) {
        const id = Number(queryId);
        if (Number.isFinite(id) && id > 0) return id;
      }

      const pathMatch = url.pathname.match(/^\/(?:series\/)?([1-9]\d*)(?:\/|$)/i);
      if (!pathMatch) continue;

      const id = Number(pathMatch[1]);
      if (Number.isFinite(id) && id > 0) return id;
    } catch {
      continue;
    }
  }
  return null;
}

export function extractMalId(externalLinks: AniListExternalLink[]): number | null {
  for (const link of externalLinks) {
    if (!link.url) continue;
    if (link.site === 'MyAnimeList' || link.url.includes('myanimelist.net')) {
      const match = link.url.match(/\/(\d+)/);
      if (match) {
        const id = Number(match[1]);
        if (Number.isFinite(id) && id > 0) return id;
      }
    }
  }
  return null;
}

export function extractTmdbId(externalLinks: AniListExternalLink[]): number | null {
  for (const link of externalLinks) {
    if (!link.url) continue;
    if (link.url.includes('themoviedb.org')) {
      const match = link.url.match(/\/(\d+)/);
      if (match) {
        const id = Number(match[1]);
        if (Number.isFinite(id) && id > 0) return id;
      }
    }
  }
  return null;
}

export function getCurrentSeason(): { season: AniListMediaSeason; year: number } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  let season: AniListMediaSeason;
  if (month >= 4 && month <= 6) {
    season = 'SPRING';
  } else if (month >= 7 && month <= 9) {
    season = 'SUMMER';
  } else if (month >= 10 && month <= 12) {
    season = 'FALL';
  } else {
    season = 'WINTER';
  }

  return { season, year };
}

export function isMovieFormat(format: AniListMediaFormat | null): boolean {
  return format === 'MOVIE';
}

export function buildSonarrAddParams(anime: { title: string; tvdbId: number | null }): string {
  const params = new URLSearchParams();
  params.set('term', anime.title);
  if (anime.tvdbId) params.set('tvdbId', String(anime.tvdbId));
  params.set('seriesType', 'anime');
  return params.toString();
}

export function buildRadarrAddParams(anime: { title: string; tmdbId: number | null }): string {
  const params = new URLSearchParams();
  params.set('term', anime.title);
  if (anime.tmdbId) params.set('tmdbId', String(anime.tmdbId));
  return params.toString();
}
