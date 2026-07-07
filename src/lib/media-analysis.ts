import { getSonarrClients, getRadarrClients } from '@/lib/service-helpers';
import { can, type PermissionUser } from '@/lib/permissions';
import { getCachedTaggedLibrary } from '@/lib/cache/tagged-library';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import type { SonarrEpisodeFileMediaInfo, EpisodeFileResource } from '@/types';
import type { MediaAnalysisFile } from '@/types/insights';

// Technical media analysis sourced from the mediaInfo Sonarr/Radarr already
// extracted (their own ffprobe pass) — Helprr never touches the files itself.
//
// Radarr rows derive live from the 120s tagged movie library (movieFile.mediaInfo
// rides along on /api/v3/movie, so it's one cheap call). Sonarr has no bulk
// episode-file endpoint — the sweep is one /episodefile call per series — so its
// normalized rows get their own longer cache (technical metadata only changes on
// import/upgrade). Mirroring tagged-library, a partial sweep is returned but NOT
// cached, so a blip can't pin an incomplete dataset for the whole TTL.

const SONARR_FILES_TTL_SECONDS = 900;
const SONARR_SWEEP_CONCURRENCY = 6;
const CACHE_SCOPE = 'media-analysis';

// ─── mediaInfo field parsing (values arrive as number | string | undefined) ───

// The *arrs report 0 for unknown bitrate/fps/channels/bitDepth; every field this
// parses is physically positive, so non-positive means "unknown", not zero.
function num(v: number | string | undefined | null): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 'x265' / 'h265' / 'HEVC' → 'HEVC', etc. Unknown codecs pass through uppercased. */
function normalizeVideoCodec(raw: string | undefined): string | null {
  if (!raw) return null;
  const c = raw.toLowerCase().replace(/[\s._-]/g, '');
  if (c.includes('av1')) return 'AV1';
  if (c.includes('265') || c.includes('hevc')) return 'HEVC';
  if (c.includes('264') || c.includes('avc')) return 'H.264';
  if (c.includes('vp9')) return 'VP9';
  if (c.includes('mpeg2')) return 'MPEG-2';
  if (c.includes('xvid') || c.includes('divx')) return 'XviD';
  if (c.includes('vc1')) return 'VC-1';
  return raw.toUpperCase();
}

function normalizeAudioCodec(raw: string | undefined): string | null {
  if (!raw) return null;
  const c = raw.toLowerCase().replace(/[\s._-]/g, '');
  if (c.includes('truehd')) return 'TrueHD';
  if (c.includes('dtsx') || c === 'dtsxma') return 'DTS:X';
  if (c.includes('dtshd') || c.includes('dtsma')) return 'DTS-HD';
  if (c.includes('dts')) return 'DTS';
  if (c.includes('eac3') || c.includes('ddp')) return 'EAC3';
  if (c.includes('ac3') || c === 'dd') return 'AC3';
  if (c.includes('aac')) return 'AAC';
  if (c.includes('flac')) return 'FLAC';
  if (c.includes('opus')) return 'Opus';
  if (c.includes('mp3')) return 'MP3';
  return raw.toUpperCase();
}

function normalizeDynamicRange(raw: string | undefined, hasMediaInfo: boolean): string | null {
  if (!raw) return hasMediaInfo ? 'SDR' : null;
  const r = raw.toLowerCase().replace(/[\s._-]/g, '');
  if (r.includes('dv')) return 'Dolby Vision';
  if (r.includes('hdr10plus') || r.includes('hdr10+')) return 'HDR10+';
  if (r.includes('hdr10')) return 'HDR10';
  if (r.includes('hlg')) return 'HLG';
  if (r.includes('pq') || r.includes('hdr')) return 'HDR';
  return 'SDR';
}

/** '3840x2160' (or a bare quality-profile height like 2160) → '2160p' bucket. */
function bucketResolution(mediaInfoRes: string | undefined, qualityRes: number | undefined): string | null {
  let width = 0;
  let height = 0;
  if (mediaInfoRes) {
    const m = mediaInfoRes.match(/(\d+)\s*x\s*(\d+)/i);
    if (m) {
      width = Number(m[1]);
      height = Number(m[2]);
    }
  }
  if (!height && qualityRes) height = qualityRes;
  if (!width && !height) return null;
  // Widescreen 4K/1080p files crop height (e.g. 3840x1600), so width decides too.
  if (height >= 1600 || width >= 3000) return '2160p';
  if (height >= 900 || width >= 1700) return '1080p';
  if (height >= 650 || width >= 1200) return '720p';
  return 'SD';
}

/**
 * '1:52:33' / '52:33' / seconds-as-number → whole minutes. Numbers are TOTAL
 * SECONDS (matching formatRuntime in the file detail pages). Non-positive
 * results are unknown, never 0 — a 0 would divide the bitrate estimate.
 */
function parseRuntimeMins(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  let mins: number;
  if (typeof raw === 'number') {
    mins = Math.round(raw / 60);
  } else {
    const parts = raw.split(':').map(Number);
    if (parts.some((p) => !Number.isFinite(p))) return null;
    if (parts.length === 3) mins = Math.round(parts[0] * 60 + parts[1] + parts[2] / 60);
    else if (parts.length === 2) mins = Math.round(parts[0] + parts[1] / 60);
    else mins = Math.round(parts[0] / 60); // bare seconds
  }
  return Number.isFinite(mins) && mins > 0 ? mins : null;
}

/** 'eng/jpn/jpn' → ['eng', 'jpn'] — one entry per language, not per stream. */
function splitLanguages(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split('/').map((s) => s.trim()).filter(Boolean))];
}

// ─── Quality score ───
// 0–100, judged from resolution (base), codec efficiency, bitrate adequacy for the
// resolution, HDR, bit depth, and audio. Scored only when the resolution is known —
// with less than that a number would be noise. Weights are heuristic, tuned so
// "1080p HEVC at a healthy bitrate" lands around 75 and "SD XviD" lands under 30.

const RESOLUTION_BASE: Record<string, number> = { '2160p': 70, '1080p': 58, '720p': 40, SD: 20 };
const CODEC_BONUS: Record<string, number> = { AV1: 12, HEVC: 10, VP9: 8, 'H.264': 4 };
/** "Healthy" video bitrate per resolution bucket (bps, HEVC-era expectations). */
const TARGET_BITRATE: Record<string, number> = {
  '2160p': 15_000_000,
  '1080p': 6_000_000,
  '720p': 3_000_000,
  SD: 1_500_000,
};

export function computeQualityScore(file: {
  resolution: string | null;
  videoCodec: string | null;
  videoBitrate: number | null;
  videoBitDepth: number | null;
  dynamicRange: string | null;
  audioChannels: number | null;
}): { score: number | null; reasons: string[] } {
  if (!file.resolution) return { score: null, reasons: [] };
  const reasons: string[] = [];

  let score = RESOLUTION_BASE[file.resolution] ?? 30;
  if (file.resolution === 'SD') reasons.push('SD resolution');
  else if (file.resolution === '720p') reasons.push('720p only');

  if (file.videoCodec) {
    const bonus = CODEC_BONUS[file.videoCodec] ?? 0;
    score += bonus;
    if (bonus === 0) reasons.push(`legacy codec (${file.videoCodec})`);
  }

  const target = TARGET_BITRATE[file.resolution];
  if (file.videoBitrate !== null && target) {
    const ratio = Math.min(file.videoBitrate / target, 1.25);
    score += Math.round(ratio * 10);
    if (ratio < 0.5) reasons.push(`low bitrate for ${file.resolution}`);
  } else {
    score += 5; // unknown bitrate: neutral, neither reward nor punish
  }

  if (file.dynamicRange && file.dynamicRange !== 'SDR') score += 5;
  if ((file.videoBitDepth ?? 0) >= 10) score += 3;
  if ((file.audioChannels ?? 0) >= 6) score += 3;
  else if ((file.audioChannels ?? 0) >= 2) score += 1;

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// ─── Row normalization ───

type TechFields = Omit<MediaAnalysisFile, 'id' | 'kind' | 'title' | 'subtitle' | 'instanceLabel' | 'size' | 'score' | 'href'>;

function normalizeMediaInfo(
  mi: SonarrEpisodeFileMediaInfo | undefined,
  qualityRes: number | undefined,
): TechFields {
  return {
    videoCodec: normalizeVideoCodec(mi?.videoCodec),
    resolution: bucketResolution(mi?.resolution, qualityRes),
    videoBitrate: num(mi?.videoBitrate),
    bitrateEstimated: false,
    videoBitDepth: num(mi?.videoBitDepth),
    dynamicRange: normalizeDynamicRange(mi?.videoDynamicRangeType, !!mi),
    videoFps: num(mi?.videoFps),
    audioCodec: normalizeAudioCodec(mi?.audioCodec),
    audioChannels: num(mi?.audioChannels),
    audioLanguages: splitLanguages(mi?.audioLanguages),
    subtitleCount: mi ? splitLanguages(mi.subtitles).length : null,
    runtimeMins: parseRuntimeMins(mi?.runTime),
  };
}

function finishRow(
  base: Pick<MediaAnalysisFile, 'id' | 'kind' | 'title' | 'subtitle' | 'instanceLabel' | 'size' | 'href'>,
  mi: SonarrEpisodeFileMediaInfo | undefined,
  qualityRes: number | undefined,
): MediaAnalysisFile {
  const tech = normalizeMediaInfo(mi, qualityRes);

  // Remuxes and MKVs muxed without track-statistics (BPS) tags report bitrate 0 —
  // the *arrs read the tag, they never measure. Fall back to overall size/runtime,
  // minus the known audio share, clamped so odd audio metadata can't gut it.
  if (tech.videoBitrate === null && tech.runtimeMins !== null && base.size > 0) {
    const overall = (base.size * 8) / (tech.runtimeMins * 60);
    const audioTotal = (num(mi?.audioBitrate) ?? 0) * (num(mi?.audioStreamCount) ?? 1);
    tech.videoBitrate = Math.round(Math.max(overall - audioTotal, overall * 0.5));
    tech.bitrateEstimated = true;
  }

  const { score } = computeQualityScore(tech);
  return { ...base, ...tech, score };
}

// ─── Dataset assembly ───

export interface MediaAnalysisDataset {
  rows: MediaAnalysisFile[];
  /** Per-service availability (mirrors tagged-library semantics). */
  available: { movies: boolean; series: boolean };
  /** True when the Sonarr sweep skipped some series (their instance answered partially). */
  partial: boolean;
}

async function buildMovieRows(): Promise<{ rows: MediaAnalysisFile[]; available: boolean }> {
  const lib = await getCachedTaggedLibrary({
    scope: 'radarr',
    cacheKeySeed: 'all',
    getInstances: () => getRadarrClients().catch(() => []),
    fetchOne: (client) => client.getMovies(),
  });
  if (!lib.available) return { rows: [], available: false };
  const rows: MediaAnalysisFile[] = [];
  for (const movie of lib.items) {
    const file = movie.movieFile;
    if (!file) continue;
    rows.push(
      finishRow(
        {
          id: `movie:${movie.instanceId}:${file.id}`,
          kind: 'movie',
          title: movie.title,
          subtitle: movie.year ? String(movie.year) : null,
          instanceLabel: movie.instanceLabel,
          size: file.size ?? 0,
          href: `/movies/${movie.id}?instance=${movie.instanceId}`,
        },
        file.mediaInfo as SonarrEpisodeFileMediaInfo | undefined,
        file.quality?.quality?.resolution,
      ),
    );
  }
  return { rows, available: true };
}

interface SonarrSweepResult {
  rows: MediaAnalysisFile[];
  available: boolean;
  partial: boolean;
}

/** Fetch every series' episode files, N series at a time per run. */
async function sweepSonarrFiles(): Promise<SonarrSweepResult> {
  // One client fetch serves both the (possible) library refresh and the sweep.
  const instances = await getSonarrClients().catch(() => []);
  const lib = await getCachedTaggedLibrary({
    scope: 'sonarr',
    cacheKeySeed: 'all',
    getInstances: () => Promise.resolve(instances),
    fetchOne: (client) => client.getSeries(),
  });
  if (!lib.available) return { rows: [], available: false, partial: false };

  const clients = new Map(instances.map(({ connection, client }) => [connection.id, client]));

  const queue = lib.items.filter((s) => (s.statistics?.episodeFileCount ?? 1) > 0);
  const rows: MediaAnalysisFile[] = [];
  let failed = false;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < queue.length) {
      const series = queue[next++];
      const client = clients.get(series.instanceId);
      if (!client) {
        failed = true;
        continue;
      }
      try {
        const files = await client.getEpisodeFiles(series.id);
        for (const file of files) {
          rows.push(
            finishRow(
              {
                id: `episode:${series.instanceId}:${file.id}`,
                kind: 'episode',
                title: series.title,
                subtitle: fileBasename(file),
                instanceLabel: series.instanceLabel,
                size: file.size ?? 0,
                href: `/series/${series.id}?instance=${series.instanceId}`,
              },
              file.mediaInfo,
              file.quality?.quality?.resolution,
            ),
          );
        }
      } catch {
        failed = true; // one bad series must not sink the sweep
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(SONARR_SWEEP_CONCURRENCY, queue.length) }, () => worker()),
  );
  return { rows, available: true, partial: failed };
}

function fileBasename(file: EpisodeFileResource): string | null {
  const p = file.relativePath ?? file.path;
  if (!p) return null;
  // Sonarr on Windows reports backslash paths.
  const base = p.split(/[\\/]/).pop();
  return base || null;
}

// Single-flight: the aggregates + files endpoints land together when the tab
// opens, and a cold cache must not run two full per-series sweeps concurrently.
let sonarrRowsInFlight: Promise<SonarrSweepResult> | null = null;

async function getSonarrRows(): Promise<SonarrSweepResult> {
  const cached = await getCachedJson<MediaAnalysisFile[]>(CACHE_SCOPE, 'sonarr');
  if (cached) return { rows: cached, available: true, partial: false };
  if (!sonarrRowsInFlight) {
    sonarrRowsInFlight = (async () => {
      try {
        const result = await sweepSonarrFiles();
        // Only a COMPLETE sweep is cached — a partial one is served once and retried next request.
        if (result.available && !result.partial) {
          await setCachedJson(CACHE_SCOPE, 'sonarr', result.rows, SONARR_FILES_TTL_SECONDS);
        }
        return result;
      } finally {
        sonarrRowsInFlight = null;
      }
    })();
  }
  return sonarrRowsInFlight;
}

/**
 * Which services a request may include: the user's permission ANDed with the
 * ?kind= scope. Shared by both media-analysis routes so they can't drift.
 */
export function analysisInclude(user: PermissionUser, kind: string | null): { movies: boolean; series: boolean } {
  return {
    movies: can(user, 'movies.view') && kind !== 'episode',
    series: can(user, 'series.view') && kind !== 'movie',
  };
}

/**
 * The combined normalized dataset, permission-filtered by the caller's flags.
 * Movies come from the shared tagged-library cache; episodes from the cached sweep.
 */
export async function getMediaAnalysisDataset(include: {
  movies: boolean;
  series: boolean;
}): Promise<MediaAnalysisDataset> {
  const [movies, episodes] = await Promise.all([
    include.movies ? buildMovieRows() : Promise.resolve({ rows: [], available: false }),
    include.series
      ? getSonarrRows()
      : Promise.resolve<SonarrSweepResult>({ rows: [], available: false, partial: false }),
  ]);
  return {
    rows: [...movies.rows, ...episodes.rows],
    available: { movies: movies.available, series: episodes.available },
    partial: episodes.partial,
  };
}
