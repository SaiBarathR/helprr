import type { AniListSeriesMapping as PrismaAniListSeriesMapping } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getAnimeDetail, getAnimeNextAiringEpisode, searchAnime } from '@/lib/anilist-client';
import {
  extractTmdbId,
  extractTvdbId,
  getPreferredTitle,
  isMovieFormat,
  normalizeAniListDetail,
} from '@/lib/anilist-helpers';
import type { SonarrSeries } from '@/types';
import type {
  AniListMedia,
  SeriesAniListCandidate,
  SeriesAniListMapping,
  SeriesAniListMappingState,
  SeriesAniListResponse,
} from '@/types/anilist';

const AUTO_UNMATCHED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_PAGE_SIZE = 10;
const ACCEPTABLE_SERIES_FORMATS = new Set(['TV', 'TV_SHORT', 'OVA', 'ONA', 'SPECIAL']);
const REJECTED_SERIES_FORMATS = new Set(['MANGA', 'NOVEL', 'ONE_SHOT']);

interface SeriesSnapshot {
  title: string;
  year: number | null;
  tvdbId: number | null;
  tmdbId: number | null;
}

interface ScoredCandidate {
  candidate: AniListMedia;
  score: number;
  method: string | null;
}

function isRejectedSeriesFormat(format: AniListMedia['format']): boolean {
  return Boolean(format && (isMovieFormat(format) || REJECTED_SERIES_FORMATS.has(format)));
}

function normalizeTitle(value: string | null | undefined): string {
  if (!value) return '';

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3000-\u9fff\uff00-\uffef]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeBaseTitle(value: string | null | undefined): string {
  return normalizeTitle(value)
    .replace(/\b(?:season|part|cour)\s+\d+\b/g, '')
    .replace(/\b(?:\d+)(?:st|nd|rd|th)\s+season\b/g, '')
    .replace(/\b(?:ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function createSnapshot(series: SonarrSeries): SeriesSnapshot {
  return {
    title: series.title,
    year: Number.isFinite(series.year) ? series.year : null,
    tvdbId: series.tvdbId > 0 ? series.tvdbId : null,
    tmdbId: series.tmdbId && series.tmdbId > 0 ? series.tmdbId : null,
  };
}

function snapshotMatches(record: PrismaAniListSeriesMapping, snapshot: SeriesSnapshot): boolean {
  return (
    record.seriesTitleSnapshot === snapshot.title
    && record.seriesYearSnapshot === snapshot.year
    && record.seriesTvdbIdSnapshot === snapshot.tvdbId
    && record.seriesTmdbIdSnapshot === snapshot.tmdbId
  );
}

function mappingFromRecord(record: PrismaAniListSeriesMapping): SeriesAniListMapping {
  return {
    sonarrSeriesId: record.sonarrSeriesId,
    anilistMediaId: record.anilistMediaId,
    state: record.state as SeriesAniListMappingState,
    matchMethod: record.matchMethod,
    confidence: record.confidence,
    resolvedAt: record.resolvedAt.toISOString(),
  };
}

function getCandidateTitles(candidate: AniListMedia): string[] {
  return [
    candidate.title.english,
    candidate.title.romaji,
    candidate.title.native,
  ].filter((value): value is string => Boolean(value));
}

function scoreCandidate(series: SonarrSeries, candidate: AniListMedia): ScoredCandidate {
  let score = 0;
  let method: string | null = null;

  const candidateTvdbId = extractTvdbId(candidate.externalLinks || []);
  const candidateTmdbId = extractTmdbId(candidate.externalLinks || []);
  const seriesTitle = normalizeTitle(series.title);
  const seriesBaseTitle = normalizeBaseTitle(series.title);
  const candidateTitles = getCandidateTitles(candidate);
  const normalizedTitles = candidateTitles.map(normalizeTitle).filter(Boolean);
  const normalizedBaseTitles = candidateTitles.map(normalizeBaseTitle).filter(Boolean);

  if (series.tvdbId > 0 && candidateTvdbId === series.tvdbId) {
    score += 140;
    method = 'tvdb_exact';
  }

  if (series.tmdbId && series.tmdbId > 0 && candidateTmdbId === series.tmdbId) {
    score += 110;
    method = method ?? 'tmdb_exact';
  }

  if (normalizedTitles.includes(seriesTitle)) {
    score += 70;
    method = method ?? 'title_exact';
  }

  if (seriesBaseTitle && normalizedBaseTitles.includes(seriesBaseTitle)) {
    score += 45;
    method = method ?? 'base_title_exact';
  }

  if (
    seriesBaseTitle
    && normalizedBaseTitles.some((title) => title.includes(seriesBaseTitle) || seriesBaseTitle.includes(title))
  ) {
    score += 20;
    method = method ?? 'base_title_partial';
  }

  const candidateYear = candidate.seasonYear ?? candidate.startDate?.year ?? null;
  if (series.year > 0 && candidateYear) {
    const diff = Math.abs(series.year - candidateYear);
    if (diff === 0) score += 18;
    else if (diff === 1) score += 10;
    else if (diff === 2) score += 4;
  }

  if (candidate.format && ACCEPTABLE_SERIES_FORMATS.has(candidate.format)) {
    score += 14;
  } else if (isRejectedSeriesFormat(candidate.format)) {
    score -= 40;
  }

  if ((candidate.popularity ?? 0) > 50_000) {
    score += 2;
  }

  return { candidate, score, method };
}

function shouldAcceptCandidate(best: ScoredCandidate | null, secondBest: ScoredCandidate | null): boolean {
  if (!best) return false;
  if (best.score >= 140) return true;
  if (best.score < 85) return false;
  if (!secondBest) return true;
  return best.score - secondBest.score >= 15;
}

async function persistMapping(
  series: SonarrSeries,
  values: {
    anilistMediaId: number | null;
    state: SeriesAniListMappingState;
    matchMethod?: string | null;
    confidence?: number | null;
  }
): Promise<PrismaAniListSeriesMapping> {
  const snapshot = createSnapshot(series);

  return prisma.aniListSeriesMapping.upsert({
    where: { sonarrSeriesId: series.id },
    update: {
      anilistMediaId: values.anilistMediaId,
      state: values.state,
      matchMethod: values.matchMethod ?? null,
      confidence: values.confidence ?? null,
      seriesTitleSnapshot: snapshot.title,
      seriesYearSnapshot: snapshot.year,
      seriesTvdbIdSnapshot: snapshot.tvdbId,
      seriesTmdbIdSnapshot: snapshot.tmdbId,
      resolvedAt: new Date(),
    },
    create: {
      sonarrSeriesId: series.id,
      anilistMediaId: values.anilistMediaId,
      state: values.state,
      matchMethod: values.matchMethod ?? null,
      confidence: values.confidence ?? null,
      seriesTitleSnapshot: snapshot.title,
      seriesYearSnapshot: snapshot.year,
      seriesTvdbIdSnapshot: snapshot.tvdbId,
      seriesTmdbIdSnapshot: snapshot.tmdbId,
      resolvedAt: new Date(),
    },
  });
}

async function collectCandidates(query: string): Promise<AniListMedia[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const result = await searchAnime(trimmed, 1, SEARCH_PAGE_SIZE);
  return result.media;
}

async function autoResolveMapping(series: SonarrSeries): Promise<PrismaAniListSeriesMapping> {
  const queries = Array.from(
    new Set(
      [
        series.title,
        normalizeBaseTitle(series.title),
      ].map((value) => value.trim()).filter(Boolean)
    )
  );

  const allCandidates = new Map<number, AniListMedia>();
  for (const query of queries) {
    const results = await collectCandidates(query);
    for (const candidate of results) {
      allCandidates.set(candidate.id, candidate);
    }
  }

  const scored = Array.from(allCandidates.values())
    .map((candidate) => scoreCandidate(series, candidate))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.candidate.popularity ?? 0) - (a.candidate.popularity ?? 0);
    });

  const best = scored[0] ?? null;
  const secondBest = scored[1] ?? null;

  if (!shouldAcceptCandidate(best, secondBest)) {
    return persistMapping(series, {
      anilistMediaId: null,
      state: 'AUTO_UNMATCHED',
      matchMethod: best?.method ?? null,
      confidence: best ? Math.max(0, best.score) : null,
    });
  }

  return persistMapping(series, {
    anilistMediaId: best!.candidate.id,
    state: 'AUTO_MATCH',
    matchMethod: best!.method ?? 'search_match',
    confidence: Math.max(0, best!.score),
  });
}

async function getCurrentMappingRecord(series: SonarrSeries): Promise<PrismaAniListSeriesMapping> {
  const snapshot = createSnapshot(series);
  const existing = await prisma.aniListSeriesMapping.findUnique({
    where: { sonarrSeriesId: series.id },
  });

  if (existing?.state === 'MANUAL_MATCH' || existing?.state === 'MANUAL_NONE') {
    return existing;
  }

  if (existing?.state === 'AUTO_MATCH' && snapshotMatches(existing, snapshot)) {
    return existing;
  }

  if (
    existing?.state === 'AUTO_UNMATCHED'
    && snapshotMatches(existing, snapshot)
    && (Date.now() - existing.resolvedAt.getTime()) < AUTO_UNMATCHED_TTL_MS
  ) {
    return existing;
  }

  return autoResolveMapping(series);
}

function mapCandidate(series: SonarrSeries, candidate: AniListMedia): SeriesAniListCandidate {
  const scored = scoreCandidate(series, candidate);

  return {
    id: candidate.id,
    title: getPreferredTitle(candidate.title),
    titleRomaji: candidate.title.romaji,
    titleNative: candidate.title.native,
    coverImage: candidate.coverImage.extraLarge || candidate.coverImage.large || null,
    format: candidate.format,
    status: candidate.status,
    seasonYear: candidate.seasonYear ?? candidate.startDate?.year ?? null,
    episodes: candidate.episodes,
    averageScore: candidate.averageScore,
    popularity: candidate.popularity,
    matchScore: scored.score,
  };
}

async function normalizeSeriesDetailWithFreshAiring(anilistMediaId: number) {
  const [detail, nextAiringEpisode] = await Promise.all([
    getAnimeDetail(anilistMediaId),
    getAnimeNextAiringEpisode(anilistMediaId),
  ]);

  return {
    detail,
    normalized: {
      ...normalizeAniListDetail(detail),
      nextAiringEpisode,
    },
  };
}

export async function getSeriesAniListResponse(series: SonarrSeries): Promise<SeriesAniListResponse> {
  const mappingRecord = await getCurrentMappingRecord(series);

  if (!mappingRecord.anilistMediaId) {
    return {
      mapping: mappingFromRecord(mappingRecord),
      detail: null,
    };
  }

  const { detail, normalized } = await normalizeSeriesDetailWithFreshAiring(mappingRecord.anilistMediaId);

  if (isRejectedSeriesFormat(detail.format)) {
    const resetRecord = await persistMapping(series, {
      anilistMediaId: null,
      state: 'AUTO_UNMATCHED',
      matchMethod: 'mapped_non_series_rejected',
      confidence: null,
    });

    return {
      mapping: mappingFromRecord(resetRecord),
      detail: null,
    };
  }

  return {
    mapping: mappingFromRecord(mappingRecord),
    detail: normalized,
  };
}

export async function searchSeriesAniListCandidates(
  series: SonarrSeries,
  query: string
): Promise<SeriesAniListCandidate[]> {
  const searchQuery = query.trim() || series.title;
  const result = await searchAnime(searchQuery, 1, 12);

  return result.media
    .filter((candidate) => candidate.format == null || ACCEPTABLE_SERIES_FORMATS.has(candidate.format))
    .map((candidate) => mapCandidate(series, candidate))
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return (b.popularity ?? 0) - (a.popularity ?? 0);
    });
}

export async function setManualSeriesAniListMapping(
  series: SonarrSeries,
  anilistMediaId: number
): Promise<SeriesAniListResponse> {
  const { detail, normalized } = await normalizeSeriesDetailWithFreshAiring(anilistMediaId);
  if (isRejectedSeriesFormat(detail.format)) {
    throw new Error('Only AniList anime series formats can be mapped to Sonarr series.');
  }

  const record = await persistMapping(series, {
    anilistMediaId,
    state: 'MANUAL_MATCH',
    matchMethod: 'manual',
    confidence: null,
  });

  return {
    mapping: mappingFromRecord(record),
    detail: normalized,
  };
}

export async function clearManualSeriesAniListMapping(series: SonarrSeries): Promise<SeriesAniListMapping> {
  const record = await persistMapping(series, {
    anilistMediaId: null,
    state: 'MANUAL_NONE',
    matchMethod: 'manual_clear',
    confidence: null,
  });

  return mappingFromRecord(record);
}
