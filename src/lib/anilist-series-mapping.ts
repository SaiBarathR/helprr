import type {
  AniListSeriesMapping as PrismaAniListSeriesMapping,
  AniListSeriesMappingEntry as PrismaEntry,
} from '@prisma/client';
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

type MappingWithEntries = PrismaAniListSeriesMapping & { entries: PrismaEntry[] };

function snapshotFields(series: SonarrSeries) {
  const snapshot = createSnapshot(series);
  return {
    seriesTitleSnapshot: snapshot.title,
    seriesYearSnapshot: snapshot.year,
    seriesTvdbIdSnapshot: snapshot.tvdbId,
    seriesTmdbIdSnapshot: snapshot.tmdbId,
  };
}

function mappingFromRecord(record: MappingWithEntries): SeriesAniListMapping {
  const entries = [...record.entries]
    .sort((a, b) => a.order - b.order)
    .map((entry) => ({
      anilistMediaId: entry.anilistMediaId,
      isPrimary: entry.isPrimary,
      order: entry.order,
    }));
  const primary = entries.find((entry) => entry.isPrimary) ?? entries[0] ?? null;

  return {
    sonarrSeriesId: record.sonarrSeriesId,
    primaryAnilistMediaId: primary?.anilistMediaId ?? null,
    entries,
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

async function loadRecord(seriesId: number): Promise<MappingWithEntries | null> {
  return prisma.aniListSeriesMapping.findUnique({
    where: { sonarrSeriesId: seriesId },
    include: { entries: { orderBy: { order: 'asc' } } },
  });
}

/**
 * Upsert the per-series resolution row and (when `entryIds` is provided) replace
 * its linked AniList entries with the given ordered list — index 0 becomes the
 * primary. Pass `entryIds: []` to clear all entries (unmatched / cleared states).
 * Omit `entryIds` to leave existing entries untouched.
 */
async function persistResolution(
  series: SonarrSeries,
  values: {
    state: SeriesAniListMappingState;
    matchMethod?: string | null;
    confidence?: number | null;
    entryIds?: number[];
  }
): Promise<MappingWithEntries> {
  const base = {
    state: values.state,
    matchMethod: values.matchMethod ?? null,
    confidence: values.confidence ?? null,
    ...snapshotFields(series),
    resolvedAt: new Date(),
  };

  const record = await prisma.aniListSeriesMapping.upsert({
    where: { sonarrSeriesId: series.id },
    update: base,
    create: { sonarrSeriesId: series.id, ...base },
  });

  if (values.entryIds !== undefined) {
    await prisma.aniListSeriesMappingEntry.deleteMany({ where: { mappingId: record.id } });
    if (values.entryIds.length > 0) {
      await prisma.aniListSeriesMappingEntry.createMany({
        data: values.entryIds.map((anilistMediaId, index) => ({
          mappingId: record.id,
          anilistMediaId,
          isPrimary: index === 0,
          order: index,
        })),
      });
    }
  }

  return (await loadRecord(series.id))!;
}

async function collectCandidates(query: string): Promise<AniListMedia[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const result = await searchAnime(trimmed, 1, SEARCH_PAGE_SIZE);
  return result.media;
}

async function autoResolveMapping(series: SonarrSeries): Promise<MappingWithEntries> {
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
    return persistResolution(series, {
      state: 'AUTO_UNMATCHED',
      matchMethod: best?.method ?? null,
      confidence: best ? Math.max(0, best.score) : null,
      entryIds: [],
    });
  }

  return persistResolution(series, {
    state: 'AUTO_MATCH',
    matchMethod: best!.method ?? 'search_match',
    confidence: Math.max(0, best!.score),
    entryIds: [best!.candidate.id],
  });
}

async function getCurrentMappingRecord(series: SonarrSeries): Promise<MappingWithEntries> {
  const snapshot = createSnapshot(series);
  const existing = await loadRecord(series.id);

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
  const record = await getCurrentMappingRecord(series);
  const orderedEntries = [...record.entries].sort((a, b) => a.order - b.order);

  if (orderedEntries.length === 0) {
    return { mapping: mappingFromRecord(record), details: [] };
  }

  const fetched = await Promise.all(
    orderedEntries.map(async (entry) => {
      try {
        const { detail, normalized } = await normalizeSeriesDetailWithFreshAiring(entry.anilistMediaId);
        return { entry, normalized: isRejectedSeriesFormat(detail.format) ? null : normalized };
      } catch {
        return { entry, normalized: null };
      }
    })
  );

  const valid = fetched.filter((item) => item.normalized !== null);
  const droppedIds = fetched.filter((item) => item.normalized === null).map((item) => item.entry.id);

  // Every linked entry is gone/invalid on AniList → reset to auto-unmatched so the
  // series falls back to TMDB enrichment (mirrors the prior single-entry behavior).
  if (valid.length === 0) {
    const reset = await persistResolution(series, {
      state: 'AUTO_UNMATCHED',
      matchMethod: 'mapped_non_series_rejected',
      confidence: null,
      entryIds: [],
    });
    return { mapping: mappingFromRecord(reset), details: [] };
  }

  // Prune invalid secondaries; promote a fresh primary if the old one was dropped.
  if (droppedIds.length > 0) {
    await prisma.aniListSeriesMappingEntry.deleteMany({ where: { id: { in: droppedIds } } });
    if (!valid.some((item) => item.entry.isPrimary)) {
      await prisma.aniListSeriesMappingEntry.update({
        where: { id: valid[0].entry.id },
        data: { isPrimary: true },
      });
    }
    const refreshed = (await loadRecord(series.id))!;
    return { mapping: mappingFromRecord(refreshed), details: valid.map((item) => item.normalized!) };
  }

  return { mapping: mappingFromRecord(record), details: valid.map((item) => item.normalized!) };
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

/** Add (or keep) an AniList entry on a series as a manual link. The first entry becomes primary. */
export async function addManualEntry(
  series: SonarrSeries,
  anilistMediaId: number
): Promise<SeriesAniListResponse> {
  const { detail } = await normalizeSeriesDetailWithFreshAiring(anilistMediaId);
  if (isRejectedSeriesFormat(detail.format)) {
    throw new Error('Only AniList anime series formats can be mapped to Sonarr series.');
  }

  const base = {
    state: 'MANUAL_MATCH' as const,
    matchMethod: 'manual',
    confidence: null,
    ...snapshotFields(series),
    resolvedAt: new Date(),
  };
  const record = await prisma.aniListSeriesMapping.upsert({
    where: { sonarrSeriesId: series.id },
    update: base,
    create: { sonarrSeriesId: series.id, ...base },
  });

  const existing = await prisma.aniListSeriesMappingEntry.findMany({
    where: { mappingId: record.id },
    orderBy: { order: 'asc' },
  });
  if (!existing.some((entry) => entry.anilistMediaId === anilistMediaId)) {
    const maxOrder = existing.reduce((max, entry) => Math.max(max, entry.order), -1);
    await prisma.aniListSeriesMappingEntry.create({
      data: {
        mappingId: record.id,
        anilistMediaId,
        isPrimary: existing.length === 0,
        order: maxOrder + 1,
      },
    });
  }

  return getSeriesAniListResponse(series);
}

/** Remove one linked AniList entry. Promotes a new primary, or clears the mapping if it was the last. */
export async function removeManualEntry(
  series: SonarrSeries,
  anilistMediaId: number
): Promise<SeriesAniListResponse> {
  const record = await loadRecord(series.id);
  const target = record?.entries.find((entry) => entry.anilistMediaId === anilistMediaId);
  if (record && target) {
    await prisma.aniListSeriesMappingEntry.delete({ where: { id: target.id } });
    const remaining = record.entries
      .filter((entry) => entry.id !== target.id)
      .sort((a, b) => a.order - b.order);
    if (remaining.length === 0) {
      await prisma.aniListSeriesMapping.update({
        where: { id: record.id },
        data: { state: 'MANUAL_NONE', matchMethod: 'manual_clear', confidence: null, resolvedAt: new Date() },
      });
    } else if (target.isPrimary) {
      await prisma.aniListSeriesMappingEntry.update({
        where: { id: remaining[0].id },
        data: { isPrimary: true },
      });
    }
  }

  return getSeriesAniListResponse(series);
}

/** Make a linked entry the primary, moving it to the front of the tab order. */
export async function setPrimaryEntry(
  series: SonarrSeries,
  anilistMediaId: number
): Promise<SeriesAniListResponse> {
  const record = await loadRecord(series.id);
  const target = record?.entries.find((entry) => entry.anilistMediaId === anilistMediaId);
  if (record && target) {
    const reordered = [
      target,
      ...record.entries.filter((entry) => entry.id !== target.id).sort((a, b) => a.order - b.order),
    ];
    await prisma.$transaction(
      reordered.map((entry, index) =>
        prisma.aniListSeriesMappingEntry.update({
          where: { id: entry.id },
          data: { isPrimary: index === 0, order: index },
        })
      )
    );
  }

  return getSeriesAniListResponse(series);
}

export async function clearManualSeriesAniListMapping(series: SonarrSeries): Promise<SeriesAniListResponse> {
  await persistResolution(series, {
    state: 'MANUAL_NONE',
    matchMethod: 'manual_clear',
    confidence: null,
    entryIds: [],
  });
  return getSeriesAniListResponse(series);
}
