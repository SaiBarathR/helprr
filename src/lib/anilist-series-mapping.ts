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
import {
  isSeasonSibling,
  normalizeBaseTitle,
  normalizeTitle,
  seasonSortKey,
} from '@/lib/anilist-title-match';
import type { SonarrSeries } from '@/types';
import type {
  AniListMedia,
  AniListRelationEdge,
  AniListTitle,
  SeriesAniListCandidate,
  SeriesAniListMapping,
  SeriesAniListMappingState,
  SeriesAniListResponse,
} from '@/types/anilist';

const AUTO_UNMATCHED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_PAGE_SIZE = 10;
const ACCEPTABLE_SERIES_FORMATS = new Set(['TV', 'TV_SHORT', 'OVA', 'ONA', 'SPECIAL']);
const REJECTED_SERIES_FORMATS = new Set(['MANGA', 'NOVEL', 'ONE_SHOT']);
// Formats season auto-linking may add without user review. OVA/SPECIAL are
// excluded on purpose — recap specials share the base title (e.g. "Attack On
// Titan: The Final Season Specials") and would link as bogus seasons; they
// stay one tap away in the drawer's suggestions instead.
const AUTO_LINK_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA']);
const MAX_AUTO_LINKED_SEASONS = 10;
const SEASON_DISCOVERY_PAGE_SIZE = 12;

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
      source: entry.source === 'auto' ? ('auto' as const) : ('manual' as const),
      titleSnapshot: entry.titleSnapshot,
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

/** One AniList entry to persist on a mapping: who linked it and its title at link time. */
interface EntryDescriptor {
  anilistMediaId: number;
  source: 'auto' | 'manual';
  titleSnapshot: string | null;
}

function dedupeEntryDescriptors(entries: EntryDescriptor[]): EntryDescriptor[] {
  const seen = new Set<number>();
  return entries.filter((entry) => {
    if (seen.has(entry.anilistMediaId)) return false;
    seen.add(entry.anilistMediaId);
    return true;
  });
}

/**
 * Upsert the per-series resolution row and (when `entries` is provided) replace
 * its linked AniList entries with the given ordered list — index 0 becomes the
 * primary. Pass `entries: []` to clear all entries (unmatched / cleared states).
 * Omit `entries` to leave existing entries untouched.
 */
async function persistResolution(
  series: SonarrSeries,
  values: {
    state: SeriesAniListMappingState;
    matchMethod?: string | null;
    confidence?: number | null;
    entries?: EntryDescriptor[];
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

  if (values.entries !== undefined) {
    const entries = dedupeEntryDescriptors(values.entries);
    await prisma.aniListSeriesMappingEntry.deleteMany({ where: { mappingId: record.id } });
    if (entries.length > 0) {
      await prisma.aniListSeriesMappingEntry.createMany({
        data: entries.map((entry, index) => ({
          mappingId: record.id,
          anilistMediaId: entry.anilistMediaId,
          isPrimary: index === 0,
          order: index,
          source: entry.source,
          titleSnapshot: entry.titleSnapshot,
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

/** Minimal shape season discovery needs from a candidate, regardless of source. */
interface SeasonCandidate {
  id: number;
  title: AniListTitle;
  format: AniListMedia['format'];
  seasonYear: number | null;
}

function titleVariants(title: AniListTitle): Array<string | null> {
  return [title.english, title.romaji, title.native];
}

function candidateSeasonSortKey(title: AniListTitle): number {
  const keys = titleVariants(title)
    .map(seasonSortKey)
    .filter((key) => Number.isFinite(key));
  return keys.length > 0 ? Math.min(...keys) : Infinity;
}

/**
 * Find AniList entries that look like other seasons of `primary` — exact base
 * title plus an explicit season marker (see anilist-title-match.ts). Candidates
 * come from the caller's search pool and/or the primary's relation edges; when
 * no pool is given (manual paths) one base-title search fills the gap. Never
 * walks the relation graph. Best-effort: returns [] on search failure.
 */
async function discoverSeasonSiblings(
  primary: AniListMedia,
  opts: { pool?: AniListMedia[]; relations?: AniListRelationEdge[] }
): Promise<EntryDescriptor[]> {
  const primaryInput = {
    titles: titleVariants(primary.title),
    year: primary.seasonYear ?? primary.startDate?.year ?? null,
  };

  const candidates = new Map<number, SeasonCandidate>();
  const add = (item: SeasonCandidate): void => {
    if (item.id !== primary.id && !candidates.has(item.id)) candidates.set(item.id, item);
  };

  for (const media of opts.pool ?? []) {
    add({
      id: media.id,
      title: media.title,
      format: media.format,
      seasonYear: media.seasonYear ?? media.startDate?.year ?? null,
    });
  }
  for (const edge of opts.relations ?? []) {
    if (edge.node.type && edge.node.type !== 'ANIME') continue;
    add({ id: edge.node.id, title: edge.node.title, format: edge.node.format, seasonYear: edge.node.seasonYear });
  }

  if (!opts.pool) {
    const base = normalizeBaseTitle(getPreferredTitle(primary.title));
    if (base) {
      try {
        const result = await searchAnime(base, 1, SEASON_DISCOVERY_PAGE_SIZE);
        for (const media of result.media) {
          add({
            id: media.id,
            title: media.title,
            format: media.format,
            seasonYear: media.seasonYear ?? media.startDate?.year ?? null,
          });
        }
      } catch {
        // Discovery is best-effort; linking the primary must not fail on a search error.
      }
    }
  }

  return Array.from(candidates.values())
    .filter(
      (candidate) =>
        candidate.format !== null
        && AUTO_LINK_FORMATS.has(candidate.format)
        && isSeasonSibling(primaryInput, { titles: titleVariants(candidate.title), year: candidate.seasonYear })
    )
    .sort((a, b) => {
      const keyDiff = candidateSeasonSortKey(a.title) - candidateSeasonSortKey(b.title);
      if (keyDiff !== 0 && !Number.isNaN(keyDiff)) return keyDiff;
      const yearDiff = (a.seasonYear ?? Infinity) - (b.seasonYear ?? Infinity);
      if (yearDiff !== 0 && !Number.isNaN(yearDiff)) return yearDiff;
      return a.id - b.id;
    })
    .slice(0, MAX_AUTO_LINKED_SEASONS)
    .map((candidate) => ({
      anilistMediaId: candidate.id,
      source: 'auto' as const,
      titleSnapshot: getPreferredTitle(candidate.title),
    }));
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
      entries: [],
    });
  }

  // Auto-link the accepted primary's season siblings from the candidate pool
  // we already searched — zero extra AniList calls on the auto path.
  const siblings = await discoverSeasonSiblings(best!.candidate, {
    pool: Array.from(allCandidates.values()),
  });

  return persistResolution(series, {
    state: 'AUTO_MATCH',
    matchMethod: best!.method ?? 'search_match',
    confidence: Math.max(0, best!.score),
    entries: [
      {
        anilistMediaId: best!.candidate.id,
        source: 'auto',
        titleSnapshot: getPreferredTitle(best!.candidate.title),
      },
      ...siblings,
    ],
  });
}

async function getCurrentMappingRecord(series: SonarrSeries): Promise<MappingWithEntries> {
  const snapshot = createSnapshot(series);
  const existing = await loadRecord(series.id);

  if (existing?.state === 'MANUAL_MATCH' || existing?.state === 'MANUAL_NONE') {
    return existing;
  }

  // A zero-entry AUTO_MATCH row is a degenerate state (e.g. left behind by a
  // schema migration) — fall through to re-resolution instead of returning it.
  if (existing?.state === 'AUTO_MATCH' && existing.entries.length > 0 && snapshotMatches(existing, snapshot)) {
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
      entries: [],
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

/**
 * Add (or keep) an AniList entry on a series as a manual link. The first entry
 * becomes primary and pulls in its season siblings automatically, so the user
 * curates down (remove a wrong one) instead of hand-adding every season.
 */
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
    const isFirst = existing.length === 0;
    const siblings = isFirst
      ? await discoverSeasonSiblings(detail, { relations: detail.relations?.edges ?? [] })
      : [];
    await prisma.$transaction([
      prisma.aniListSeriesMappingEntry.create({
        data: {
          mappingId: record.id,
          anilistMediaId,
          isPrimary: isFirst,
          order: maxOrder + 1,
          source: 'manual',
          titleSnapshot: getPreferredTitle(detail.title),
        },
      }),
      ...(siblings.length > 0
        ? [
            prisma.aniListSeriesMappingEntry.createMany({
              data: siblings.map((sibling, index) => ({
                mappingId: record.id,
                anilistMediaId: sibling.anilistMediaId,
                isPrimary: false,
                order: maxOrder + 2 + index,
                source: sibling.source,
                titleSnapshot: sibling.titleSnapshot,
              })),
            }),
          ]
        : []),
    ]);
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
    } else {
      if (target.isPrimary) {
        await prisma.aniListSeriesMappingEntry.update({
          where: { id: remaining[0].id },
          data: { isPrimary: true },
        });
      }
      // Removing an entry is curation — pin the mapping as MANUAL_MATCH so a
      // later snapshot-triggered auto re-resolve can't re-add the removed one.
      if (record.state !== 'MANUAL_MATCH') {
        await prisma.aniListSeriesMapping.update({
          where: { id: record.id },
          data: { state: 'MANUAL_MATCH', matchMethod: 'manual', confidence: null, resolvedAt: new Date() },
        });
      }
    }
  }

  return getSeriesAniListResponse(series);
}

/**
 * Make a linked entry the primary, moving it to the front of the tab order.
 * The new primary's missing season siblings are auto-appended (never removed),
 * and the mapping is pinned as MANUAL_MATCH — choosing a primary is curation.
 */
export async function setPrimaryEntry(
  series: SonarrSeries,
  anilistMediaId: number
): Promise<SeriesAniListResponse> {
  const record = await loadRecord(series.id);
  const target = record?.entries.find((entry) => entry.anilistMediaId === anilistMediaId);
  if (record && target) {
    // Discover up front (reads only) so reorder + append land in one transaction.
    let siblings: EntryDescriptor[] = [];
    try {
      const detail = await getAnimeDetail(anilistMediaId);
      siblings = await discoverSeasonSiblings(detail, { relations: detail.relations?.edges ?? [] });
    } catch {
      // Best-effort: changing the primary must not fail on discovery errors.
    }
    const linkedIds = new Set(record.entries.map((entry) => entry.anilistMediaId));
    const additions = siblings.filter((sibling) => !linkedIds.has(sibling.anilistMediaId));

    const reordered = [
      target,
      ...record.entries.filter((entry) => entry.id !== target.id).sort((a, b) => a.order - b.order),
    ];
    await prisma.$transaction([
      ...reordered.map((entry, index) =>
        prisma.aniListSeriesMappingEntry.update({
          where: { id: entry.id },
          data: { isPrimary: index === 0, order: index },
        })
      ),
      ...(additions.length > 0
        ? [
            prisma.aniListSeriesMappingEntry.createMany({
              data: additions.map((sibling, index) => ({
                mappingId: record.id,
                anilistMediaId: sibling.anilistMediaId,
                isPrimary: false,
                order: reordered.length + index,
                source: sibling.source,
                titleSnapshot: sibling.titleSnapshot,
              })),
            }),
          ]
        : []),
      ...(record.state !== 'MANUAL_MATCH'
        ? [
            prisma.aniListSeriesMapping.update({
              where: { id: record.id },
              data: { state: 'MANUAL_MATCH', matchMethod: 'manual', confidence: null, resolvedAt: new Date() },
            }),
          ]
        : []),
    ]);
  }

  return getSeriesAniListResponse(series);
}

export async function clearManualSeriesAniListMapping(series: SonarrSeries): Promise<SeriesAniListResponse> {
  await persistResolution(series, {
    state: 'MANUAL_NONE',
    matchMethod: 'manual_clear',
    confidence: null,
    entries: [],
  });
  return getSeriesAniListResponse(series);
}
