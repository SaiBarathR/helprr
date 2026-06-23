import type {
  AniListSeriesMapping as PrismaAniListSeriesMapping,
  AniListSeriesMappingEntry as PrismaEntry,
} from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  AniListRateLimitError,
  getAnimeDetail,
  getAnimeNextAiringEpisode,
  searchAnime,
} from '@/lib/anilist-client';
import {
  extractTmdbId,
  ACCEPTABLE_SERIES_FORMATS,
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
  AniListDetailResponse,
  AniListMedia,
  AniListRelationEdge,
  AniListTitle,
  SeriesAniListCandidate,
  SeriesAniListEntryDetailResponse,
  SeriesAniListMapping,
  SeriesAniListMappingState,
  SeriesAniListResponse,
} from '@/types/anilist';

const AUTO_UNMATCHED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_PAGE_SIZE = 10;
const REJECTED_SERIES_FORMATS = new Set(['MANGA', 'NOVEL', 'ONE_SHOT']);
// Formats season auto-linking may add without user review. OVA/SPECIAL are
// excluded on purpose — recap specials share the base title (e.g. "Attack On
// Titan: The Final Season Specials") and would link as bogus seasons; they
// stay one tap away in the drawer's suggestions instead.
const AUTO_LINK_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA']);
const MAX_AUTO_LINKED_SEASONS = 10;
const SEASON_DISCOVERY_PAGE_SIZE = 12;
// Relation-enrichment depth: the first pass inspects the primary (or, on
// manual links, consumes its pre-fetched relations via seedRelations) + pass-0
// siblings; later passes only newly-discovered ones. 3 covers
// S1→…→Final Season Part 2.
const MAX_ENRICHMENT_PASSES = 3;

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

/**
 * Display order for linked entries: primary first, then season order parsed
 * from title snapshots, then the persisted order. Sorting at presentation time
 * (instead of trusting the DB `order`) fixes rows persisted before the season
 * sort existed without requiring a reset.
 */
function presentationSortEntries(entries: PrismaEntry[]): PrismaEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    const keyDiff = seasonSortKey(a.titleSnapshot) - seasonSortKey(b.titleSnapshot);
    if (keyDiff !== 0 && !Number.isNaN(keyDiff)) return keyDiff;
    return a.order - b.order;
  });
}

function mappingFromRecord(record: MappingWithEntries): SeriesAniListMapping {
  const entries = presentationSortEntries(record.entries)
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

async function loadRecord(sonarrInstanceId: string, seriesId: number): Promise<MappingWithEntries | null> {
  return prisma.aniListSeriesMapping.findUnique({
    where: { sonarrInstanceId_sonarrSeriesId: { sonarrInstanceId, sonarrSeriesId: seriesId } },
    include: { entries: { orderBy: { order: 'asc' } } },
  });
}

/** A Sonarr series an AniList entry has been mapped to (reverse of the per-series mapping). */
export interface AnilistLibraryLink {
  sonarrInstanceId: string;
  sonarrSeriesId: number;
}

/**
 * Reverse lookup: given AniList media ids, find the Sonarr series each is mapped
 * to. This is the symmetric counterpart of the series→anime mapping and is how
 * the anime pages know a (possibly season-split) entry is in the library —
 * title matching alone misses sequels whose AniList title/ids don't line up with
 * the single Sonarr series. Only matched states contribute; callers still
 * intersect with the live library to drop stale links and to get the title slug.
 */
export async function loadLibraryLinksForAnilistIds(
  anilistMediaIds: number[]
): Promise<Map<number, AnilistLibraryLink[]>> {
  const ids = Array.from(new Set(anilistMediaIds)).filter((id) => Number.isFinite(id) && id > 0);
  const map = new Map<number, AnilistLibraryLink[]>();
  if (ids.length === 0) return map;

  const entries = await prisma.aniListSeriesMappingEntry.findMany({
    where: { anilistMediaId: { in: ids } },
    include: { mapping: { select: { sonarrInstanceId: true, sonarrSeriesId: true, state: true } } },
  });

  for (const entry of entries) {
    // Entries only exist for matched states, but guard against degenerate rows.
    if (entry.mapping.state !== 'AUTO_MATCH' && entry.mapping.state !== 'MANUAL_MATCH') continue;
    const list = map.get(entry.anilistMediaId) ?? [];
    list.push({ sonarrInstanceId: entry.mapping.sonarrInstanceId, sonarrSeriesId: entry.mapping.sonarrSeriesId });
    map.set(entry.anilistMediaId, list);
  }
  return map;
}

/**
 * Forward lookup: every matched Sonarr series → the AniList media ids linked to
 * it, keyed `${sonarrInstanceId}:${sonarrSeriesId}`. The watch-status map uses
 * this to alias a series' Jellyfin status under `anilist:<id>` so the AniList
 * browse rails/library (which only hold AniList ids) can show watch state.
 */
export async function loadAnilistIdsBySeries(): Promise<Map<string, number[]>> {
  const entries = await prisma.aniListSeriesMappingEntry.findMany({
    where: { mapping: { state: { in: ['AUTO_MATCH', 'MANUAL_MATCH'] } } },
    include: { mapping: { select: { sonarrInstanceId: true, sonarrSeriesId: true } } },
  });

  const map = new Map<string, number[]>();
  for (const entry of entries) {
    const key = `${entry.mapping.sonarrInstanceId}:${entry.mapping.sonarrSeriesId}`;
    const list = map.get(key) ?? [];
    list.push(entry.anilistMediaId);
    map.set(key, list);
  }
  return map;
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
  sonarrInstanceId: string,
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

  // One transaction so concurrent resolvers (series-page GET, anime reverse
  // lookup, the nightly auto-map loop) never observe a mapping whose entries
  // are mid-replacement.
  return prisma.$transaction(async (tx) => {
    const record = await tx.aniListSeriesMapping.upsert({
      where: { sonarrInstanceId_sonarrSeriesId: { sonarrInstanceId, sonarrSeriesId: series.id } },
      update: base,
      create: { sonarrInstanceId, sonarrSeriesId: series.id, ...base },
    });

    if (values.entries !== undefined) {
      const entries = dedupeEntryDescriptors(values.entries);
      await tx.aniListSeriesMappingEntry.deleteMany({ where: { mappingId: record.id } });
      if (entries.length > 0) {
        await tx.aniListSeriesMappingEntry.createMany({
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

    // Same shape as loadRecord, read inside the transaction.
    return (await tx.aniListSeriesMapping.findUnique({
      where: { sonarrInstanceId_sonarrSeriesId: { sonarrInstanceId, sonarrSeriesId: series.id } },
      include: { entries: { orderBy: { order: 'asc' } } },
    }))!;
  });
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

function mediaToSeasonCandidate(media: AniListMedia): SeasonCandidate {
  return {
    id: media.id,
    title: media.title,
    format: media.format,
    seasonYear: media.seasonYear ?? media.startDate?.year ?? null,
  };
}

function relationEdgeToSeasonCandidate(edge: AniListRelationEdge): SeasonCandidate | null {
  if (edge.node.type && edge.node.type !== 'ANIME') return null;
  return { id: edge.node.id, title: edge.node.title, format: edge.node.format, seasonYear: edge.node.seasonYear };
}

/**
 * Find AniList entries that look like other seasons of `primary` — exact base
 * title plus an explicit season marker (see anilist-title-match.ts). Pass 0
 * screens the caller's search pool and/or the primary's relation edges (plus
 * one base-title search when no pool is given). Then a bounded enrichment walk
 * inspects the accepted siblings' own relations to catch seasons fuzzy search
 * misses (e.g. AoT "Final Season Part 2" only appears as FS's SEQUEL edge).
 * The sibling filter keeps the walk inside the franchise; each detail fetch is
 * Redis-cached 24h and gets fetched for the page right after anyway.
 * Best-effort throughout: fetch failures skip that candidate, never throw.
 */
async function resolveSeasonSiblingDescriptors(
  primary: AniListMedia,
  opts: { pool?: AniListMedia[]; seedRelations?: AniListRelationEdge[]; excludeIds?: Set<number> }
): Promise<EntryDescriptor[]> {
  const primaryInput = {
    titles: titleVariants(primary.title),
    year: primary.seasonYear ?? primary.startDate?.year ?? null,
  };

  const accepted = new Map<number, SeasonCandidate>();
  const addAccepted = (candidate: SeasonCandidate): boolean => {
    if (
      candidate.id === primary.id
      || accepted.has(candidate.id)
      || opts.excludeIds?.has(candidate.id)
      || candidate.format === null
      || !AUTO_LINK_FORMATS.has(candidate.format)
      || !isSeasonSibling(primaryInput, { titles: titleVariants(candidate.title), year: candidate.seasonYear })
    ) {
      return false;
    }
    accepted.set(candidate.id, candidate);
    return true;
  };

  // Pass 0 — pool (auto path), the primary's own relations (manual paths), and
  // one base-title search when no pool was provided.
  for (const media of opts.pool ?? []) addAccepted(mediaToSeasonCandidate(media));
  for (const edge of opts.seedRelations ?? []) {
    const candidate = relationEdgeToSeasonCandidate(edge);
    if (candidate) addAccepted(candidate);
  }
  if (!opts.pool) {
    const base = normalizeBaseTitle(getPreferredTitle(primary.title));
    if (base) {
      try {
        const result = await searchAnime(base, 1, SEASON_DISCOVERY_PAGE_SIZE);
        for (const media of result.media) addAccepted(mediaToSeasonCandidate(media));
      } catch {
        // Discovery is best-effort; linking the primary must not fail on a search error.
      }
    }
  }

  // Enrichment walk over accepted siblings' relations (and the primary's, when
  // they weren't the seed). Cycles can't loop (`inspected`) and the walk can't
  // leave the base title (only accepted siblings join the frontier).
  const inspected = new Set<number>();
  if (opts.seedRelations) inspected.add(primary.id);
  let frontier = [primary.id, ...accepted.keys()].filter((id) => !inspected.has(id));
  for (
    let pass = 0;
    pass < MAX_ENRICHMENT_PASSES && frontier.length > 0 && accepted.size < MAX_AUTO_LINKED_SEASONS;
    pass += 1
  ) {
    const details = await Promise.all(
      frontier.map(async (id) => {
        inspected.add(id);
        try {
          return await getAnimeDetail(id);
        } catch {
          return null;
        }
      })
    );

    const discovered: number[] = [];
    for (const detail of details) {
      for (const edge of detail?.relations?.edges ?? []) {
        if (accepted.size >= MAX_AUTO_LINKED_SEASONS) break;
        const candidate = relationEdgeToSeasonCandidate(edge);
        if (candidate && addAccepted(candidate)) discovered.push(candidate.id);
      }
    }
    frontier = discovered;
  }

  return Array.from(accepted.values())
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

async function autoResolveMapping(sonarrInstanceId: string, series: SonarrSeries): Promise<MappingWithEntries> {
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
    return persistResolution(sonarrInstanceId, series, {
      state: 'AUTO_UNMATCHED',
      matchMethod: best?.method ?? null,
      confidence: best ? Math.max(0, best.score) : null,
      entries: [],
    });
  }

  // Auto-link the accepted primary's season siblings: pass 0 screens the
  // candidate pool we already searched; the relation walk catches the rest.
  const siblings = await resolveSeasonSiblingDescriptors(best!.candidate, {
    pool: Array.from(allCandidates.values()),
  });

  return persistResolution(sonarrInstanceId, series, {
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

async function getCurrentMappingRecord(sonarrInstanceId: string, series: SonarrSeries): Promise<MappingWithEntries> {
  const snapshot = createSnapshot(series);
  const existing = await loadRecord(sonarrInstanceId, series.id);

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

  return autoResolveMapping(sonarrInstanceId, series);
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

/**
 * Normalize one entry's detail. `freshAiring` swaps the detail-embedded
 * nextAiringEpisode (≤24h-stale, zero extra calls) for a dedicated 10-min-fresh
 * lookup — only worth the extra AniList call where a countdown is on screen.
 */
async function normalizeSeriesDetail(anilistMediaId: number, opts: { freshAiring?: boolean } = {}) {
  const detail = await getAnimeDetail(anilistMediaId);
  const normalized = normalizeAniListDetail(detail);
  if (opts.freshAiring) {
    normalized.nextAiringEpisode = await getAnimeNextAiringEpisode(anilistMediaId);
  }
  return { detail, normalized };
}

/** Fetch + format-validate one entry's detail. Null = dead/invalid on AniList. */
async function validateEntryDetail(
  entry: PrismaEntry,
  opts: { freshAiring?: boolean } = {}
): Promise<AniListDetailResponse | null> {
  try {
    const { detail, normalized } = await normalizeSeriesDetail(entry.anilistMediaId, opts);
    return isRejectedSeriesFormat(detail.format) ? null : normalized;
  } catch (error) {
    // A rate-limit window says nothing about the entry's health — rethrow so
    // callers 429 instead of pruning entries / resetting the mapping.
    if (error instanceof AniListRateLimitError) throw error;
    return null;
  }
}

/**
 * Lazily resolve a series' mapping (auto-match + season linking) without
 * fetching any entry details — the same resolution a series-page visit
 * triggers. Used by the anime-page reverse lookup so an anime that's in the
 * Sonarr library shows as mapped even before its series page was ever opened.
 */
export async function ensureSeriesAniListMapping(series: SonarrSeries, sonarrInstanceId: string): Promise<void> {
  await getCurrentMappingRecord(sonarrInstanceId, series);
}

/**
 * Resolve the mapping and fetch linked entry details. `scope: 'all'` (default —
 * used by all mutation responses) fetches every entry. `scope: 'primary'` (the
 * page-load GET) fetches/validates only the first entry, promoting past dead
 * ones; the rest load lazily when their tab is selected.
 */
export async function getSeriesAniListResponse(
  series: SonarrSeries,
  sonarrInstanceId: string,
  opts: { scope?: 'all' | 'primary' } = {}
): Promise<SeriesAniListResponse> {
  const record = await getCurrentMappingRecord(sonarrInstanceId, series);
  // Same order as mappingFromRecord so details[i] aligns with mapping.entries[i].
  const orderedEntries = presentationSortEntries(record.entries);

  if (orderedEntries.length === 0) {
    return { mapping: mappingFromRecord(record), details: [] };
  }

  if ((opts.scope ?? 'all') === 'primary') {
    const remaining = [...orderedEntries];
    const droppedIds: string[] = [];
    let primaryDetail: AniListDetailResponse | null = null;
    while (remaining.length > 0 && primaryDetail === null) {
      primaryDetail = await validateEntryDetail(remaining[0], { freshAiring: true });
      if (primaryDetail === null) {
        droppedIds.push(remaining[0].id);
        remaining.shift();
      }
    }

    if (primaryDetail === null) {
      // A manual mapping stays manual (MANUAL_NONE) so the user's curation
      // lock survives — auto re-resolve must not replace what they pinned.
      const reset = await persistResolution(sonarrInstanceId, series, {
        state: record.state === 'MANUAL_MATCH' ? 'MANUAL_NONE' : 'AUTO_UNMATCHED',
        matchMethod: 'mapped_non_series_rejected',
        confidence: null,
        entries: [],
      });
      return { mapping: mappingFromRecord(reset), details: [] };
    }

    if (droppedIds.length > 0) {
      // Atomic prune + promote — readers never see a primary-less mapping.
      await prisma.$transaction([
        prisma.aniListSeriesMappingEntry.deleteMany({ where: { id: { in: droppedIds } } }),
        prisma.aniListSeriesMappingEntry.update({
          where: { id: remaining[0].id },
          data: { isPrimary: true },
        }),
      ]);
      const refreshed = (await loadRecord(sonarrInstanceId, series.id))!;
      return { mapping: mappingFromRecord(refreshed), details: [primaryDetail] };
    }

    return { mapping: mappingFromRecord(record), details: [primaryDetail] };
  }

  // Fresh airing only for the primary (the visible countdown); the rest keep
  // the detail-embedded value — halves upstream calls on full-scope fetches.
  const fetched = await Promise.all(
    orderedEntries.map(async (entry, index) => ({
      entry,
      normalized: await validateEntryDetail(entry, { freshAiring: index === 0 }),
    }))
  );

  const valid = fetched.filter((item) => item.normalized !== null);
  const droppedIds = fetched.filter((item) => item.normalized === null).map((item) => item.entry.id);

  // Every linked entry is gone/invalid on AniList → reset so the series falls
  // back to TMDB enrichment. A manual mapping resets to MANUAL_NONE (keeps the
  // curation lock); an auto one to AUTO_UNMATCHED (re-resolve may retry).
  if (valid.length === 0) {
    const reset = await persistResolution(sonarrInstanceId, series, {
      state: record.state === 'MANUAL_MATCH' ? 'MANUAL_NONE' : 'AUTO_UNMATCHED',
      matchMethod: 'mapped_non_series_rejected',
      confidence: null,
      entries: [],
    });
    return { mapping: mappingFromRecord(reset), details: [] };
  }

  // Prune invalid secondaries; promote a fresh primary if the old one was
  // dropped — atomically, so readers never see a primary-less mapping.
  if (droppedIds.length > 0) {
    await prisma.$transaction([
      prisma.aniListSeriesMappingEntry.deleteMany({ where: { id: { in: droppedIds } } }),
      ...(!valid.some((item) => item.entry.isPrimary)
        ? [
            prisma.aniListSeriesMappingEntry.update({
              where: { id: valid[0].entry.id },
              data: { isPrimary: true },
            }),
          ]
        : []),
    ]);
    const refreshed = (await loadRecord(sonarrInstanceId, series.id))!;
    return { mapping: mappingFromRecord(refreshed), details: valid.map((item) => item.normalized!) };
  }

  return { mapping: mappingFromRecord(record), details: valid.map((item) => item.normalized!) };
}

/**
 * Lazy per-tab fetch: one linked entry's detail. `detail: null` means the id
 * isn't (or is no longer) part of the mapping — dead entries are pruned here,
 * and the client refetches the full response to resync.
 */
export async function getSeriesEntryDetail(
  series: SonarrSeries,
  sonarrInstanceId: string,
  anilistMediaId: number
): Promise<SeriesAniListEntryDetailResponse> {
  const record = await loadRecord(sonarrInstanceId, series.id);
  if (!record) {
    const resolved = await getCurrentMappingRecord(sonarrInstanceId, series);
    return { mapping: mappingFromRecord(resolved), detail: null };
  }

  const entry = record.entries.find((item) => item.anilistMediaId === anilistMediaId);
  if (!entry) {
    return { mapping: mappingFromRecord(record), detail: null };
  }

  const detail = await validateEntryDetail(entry, { freshAiring: true });
  if (detail) {
    return { mapping: mappingFromRecord(record), detail };
  }

  // Dead/invalid on AniList — prune; promote a new primary or reset when empty.
  const remaining = presentationSortEntries(record.entries.filter((item) => item.id !== entry.id));
  if (remaining.length === 0) {
    // Manual mappings reset to MANUAL_NONE so the curation lock survives.
    // persistResolution's transaction clears the dead entry along with the rest.
    const reset = await persistResolution(sonarrInstanceId, series, {
      state: record.state === 'MANUAL_MATCH' ? 'MANUAL_NONE' : 'AUTO_UNMATCHED',
      matchMethod: 'mapped_non_series_rejected',
      confidence: null,
      entries: [],
    });
    return { mapping: mappingFromRecord(reset), detail: null };
  }
  // Atomic prune + promote — readers never see a primary-less mapping.
  await prisma.$transaction([
    prisma.aniListSeriesMappingEntry.delete({ where: { id: entry.id } }),
    ...(entry.isPrimary
      ? [
          prisma.aniListSeriesMappingEntry.update({
            where: { id: remaining[0].id },
            data: { isPrimary: true },
          }),
        ]
      : []),
  ]);
  const refreshed = (await loadRecord(sonarrInstanceId, series.id))!;
  return { mapping: mappingFromRecord(refreshed), detail: null };
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
  sonarrInstanceId: string,
  anilistMediaId: number
): Promise<SeriesAniListResponse> {
  const { detail } = await normalizeSeriesDetail(anilistMediaId);
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
    where: { sonarrInstanceId_sonarrSeriesId: { sonarrInstanceId, sonarrSeriesId: series.id } },
    update: base,
    create: { sonarrInstanceId, sonarrSeriesId: series.id, ...base },
  });

  // Sibling discovery hits AniList — keep it outside the transaction, keyed
  // off a pre-read (siblings only matter when this becomes the first entry).
  const preExisting = await prisma.aniListSeriesMappingEntry.count({
    where: { mappingId: record.id },
  });
  const siblings = preExisting === 0
    ? await resolveSeasonSiblingDescriptors(detail, { seedRelations: detail.relations?.edges ?? [] })
    : [];

  // Re-read inside the transaction: the pre-read spans AniList calls, so two
  // concurrent adds could both observe an empty mapping. Recomputing isFirst
  // here (and demoting any primary a racer committed meanwhile) keeps the
  // "exactly one primary" invariant.
  await prisma.$transaction(async (tx) => {
    const existing = await tx.aniListSeriesMappingEntry.findMany({
      where: { mappingId: record.id },
      orderBy: { order: 'asc' },
    });
    if (existing.some((entry) => entry.anilistMediaId === anilistMediaId)) return;
    const maxOrder = existing.reduce((max, entry) => Math.max(max, entry.order), -1);
    const isFirst = existing.length === 0;
    if (isFirst) {
      await tx.aniListSeriesMappingEntry.updateMany({
        where: { mappingId: record.id, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    await tx.aniListSeriesMappingEntry.create({
      data: {
        mappingId: record.id,
        anilistMediaId,
        isPrimary: isFirst,
        order: maxOrder + 1,
        source: 'manual',
        titleSnapshot: getPreferredTitle(detail.title),
      },
    });
    if (isFirst && siblings.length > 0) {
      await tx.aniListSeriesMappingEntry.createMany({
        data: siblings.map((sibling, index) => ({
          mappingId: record.id,
          anilistMediaId: sibling.anilistMediaId,
          isPrimary: false,
          order: maxOrder + 2 + index,
          source: sibling.source,
          titleSnapshot: sibling.titleSnapshot,
        })),
      });
    }
  });

  return getSeriesAniListResponse(series, sonarrInstanceId);
}

/** Remove one linked AniList entry. Promotes a new primary, or clears the mapping if it was the last. */
export async function removeManualEntry(
  series: SonarrSeries,
  sonarrInstanceId: string,
  anilistMediaId: number
): Promise<SeriesAniListResponse> {
  const record = await loadRecord(sonarrInstanceId, series.id);
  const target = record?.entries.find((entry) => entry.anilistMediaId === anilistMediaId);
  if (record && target) {
    const remaining = record.entries
      .filter((entry) => entry.id !== target.id)
      .sort((a, b) => a.order - b.order);
    // One transaction so the delete and its follow-ups (promote / state pin)
    // land together — readers never see a primary-less mapping.
    await prisma.$transaction([
      prisma.aniListSeriesMappingEntry.delete({ where: { id: target.id } }),
      ...(remaining.length === 0
        ? [
            prisma.aniListSeriesMapping.update({
              where: { id: record.id },
              data: { state: 'MANUAL_NONE', matchMethod: 'manual_clear', confidence: null, resolvedAt: new Date() },
            }),
          ]
        : [
            ...(target.isPrimary
              ? [
                  prisma.aniListSeriesMappingEntry.update({
                    where: { id: remaining[0].id },
                    data: { isPrimary: true },
                  }),
                ]
              : []),
            // Removing an entry is curation — pin the mapping as MANUAL_MATCH so a
            // later snapshot-triggered auto re-resolve can't re-add the removed one.
            ...(record.state !== 'MANUAL_MATCH'
              ? [
                  prisma.aniListSeriesMapping.update({
                    where: { id: record.id },
                    data: { state: 'MANUAL_MATCH', matchMethod: 'manual', confidence: null, resolvedAt: new Date() },
                  }),
                ]
              : []),
          ]),
    ]);
  }

  return getSeriesAniListResponse(series, sonarrInstanceId);
}

/**
 * Make a linked entry the primary, moving it to the front of the tab order.
 * The new primary's missing season siblings are auto-appended (never removed),
 * and the mapping is pinned as MANUAL_MATCH — choosing a primary is curation.
 */
export async function setPrimaryEntry(
  series: SonarrSeries,
  sonarrInstanceId: string,
  anilistMediaId: number
): Promise<SeriesAniListResponse> {
  const record = await loadRecord(sonarrInstanceId, series.id);
  const target = record?.entries.find((entry) => entry.anilistMediaId === anilistMediaId);
  if (record && target) {
    const linkedIds = new Set(record.entries.map((entry) => entry.anilistMediaId));
    // Discover up front (reads only) so reorder + append land in one transaction.
    let additions: EntryDescriptor[] = [];
    try {
      const detail = await getAnimeDetail(anilistMediaId);
      additions = (
        await resolveSeasonSiblingDescriptors(detail, {
          seedRelations: detail.relations?.edges ?? [],
          excludeIds: linkedIds,
        })
      ).filter((sibling) => !linkedIds.has(sibling.anilistMediaId));
    } catch {
      // Best-effort: changing the primary must not fail on discovery errors.
    }

    // Primary pinned first; existing tail and discovered additions merge into
    // season order (Season 1 … Season 3 Part 2 … Final Season Part 2).
    type TailItem =
      | { kind: 'existing'; key: number; tiebreak: number; entry: PrismaEntry }
      | { kind: 'new'; key: number; tiebreak: number; descriptor: EntryDescriptor };
    const tail: TailItem[] = [
      ...record.entries
        .filter((entry) => entry.id !== target.id)
        .map((entry): TailItem => ({ kind: 'existing', key: seasonSortKey(entry.titleSnapshot), tiebreak: entry.order, entry })),
      ...additions.map(
        (descriptor, index): TailItem => ({
          kind: 'new',
          key: seasonSortKey(descriptor.titleSnapshot),
          tiebreak: Number.MAX_SAFE_INTEGER - additions.length + index,
          descriptor,
        })
      ),
    ].sort((a, b) => {
      const keyDiff = a.key - b.key;
      if (keyDiff !== 0 && !Number.isNaN(keyDiff)) return keyDiff;
      return a.tiebreak - b.tiebreak;
    });

    await prisma.$transaction([
      prisma.aniListSeriesMappingEntry.update({
        where: { id: target.id },
        data: { isPrimary: true, order: 0 },
      }),
      ...tail.map((item, index) =>
        item.kind === 'existing'
          ? prisma.aniListSeriesMappingEntry.update({
              where: { id: item.entry.id },
              data: { isPrimary: false, order: index + 1 },
            })
          : prisma.aniListSeriesMappingEntry.create({
              data: {
                mappingId: record.id,
                anilistMediaId: item.descriptor.anilistMediaId,
                isPrimary: false,
                order: index + 1,
                source: item.descriptor.source,
                titleSnapshot: item.descriptor.titleSnapshot,
              },
            })
      ),
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

  return getSeriesAniListResponse(series, sonarrInstanceId);
}

export async function clearManualSeriesAniListMapping(series: SonarrSeries, sonarrInstanceId: string): Promise<SeriesAniListResponse> {
  await persistResolution(sonarrInstanceId, series, {
    state: 'MANUAL_NONE',
    matchMethod: 'manual_clear',
    confidence: null,
    entries: [],
  });
  return getSeriesAniListResponse(series, sonarrInstanceId);
}
