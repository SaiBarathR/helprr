import { isAxiosError } from 'axios';
import { NextResponse } from 'next/server';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { ArrLanguage, ArrQualityModel, RadarrGrabRequest, SonarrGrabRequest } from '@/types';

/*
 * Sonarr/Radarr interactive-search grabs (POST /api/v3/release). The *arr finds
 * the release in its search cache by indexerId + guid. A release it couldn't
 * match to a series and episodes (or a movie) only grabs with the searched
 * item ("context") or the user's own choice ("override"), as in its own UI.
 * The outgoing body is rebuilt from validated fields only.
 */

type Parsed<T> = { ok: true; request: T } | { ok: false; error: string };
type Body = Record<string, unknown>;

// The browser sends the token its search was given for the guid (release-tokens);
// the route resolves it. This only bounds what is read.
const MAX_GUID = 16_384;
// Whole seasons of long-running anime stay under this; more is not a real release.
const MAX_EPISODES = 500;
const MAX_LANGUAGES = 50;
const MAX_TEXT = 100;

const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
// Quality and language 0 is "Unknown"; season 0 is Specials.
const isWhole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT;
const has = (body: Body, key: string) => body[key] !== undefined;

function parseBase(body: unknown): { ok: true; body: Body; base: { guid: string; indexerId: number; downloadClientId?: number } } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid request body' };
  const b = body as Body;
  if (typeof b.guid !== 'string' || !b.guid || b.indexerId === undefined) return { ok: false, error: 'guid and indexerId are required' };
  if (b.guid.length > MAX_GUID || !isId(b.indexerId)) return { ok: false, error: 'Invalid release' };
  if (has(b, 'downloadClientId') && b.downloadClientId !== null && !isId(b.downloadClientId)) {
    return { ok: false, error: 'Invalid download client' };
  }
  const base = { guid: b.guid, indexerId: b.indexerId as number };
  return { ok: true, body: b, base: isId(b.downloadClientId) ? { ...base, downloadClientId: b.downloadClientId } : base };
}

function parseQuality(v: unknown): ArrQualityModel | null {
  if (!v || typeof v !== 'object') return null;
  const { quality: q, revision: r } = v as { quality?: Record<string, unknown>; revision?: Record<string, unknown> };
  if (!q || typeof q !== 'object' || !isWhole(q.id) || !isText(q.name)) return null;
  if (!r || typeof r !== 'object' || !isId(r.version) || !isWhole(r.real) || typeof r.isRepack !== 'boolean') return null;
  const quality: ArrQualityModel['quality'] = { id: q.id, name: q.name };
  if (isText(q.source)) quality.source = q.source;
  if (isWhole(q.resolution)) quality.resolution = q.resolution;
  if (isText(q.modifier)) quality.modifier = q.modifier;
  return { quality, revision: { version: r.version, real: r.real, isRepack: r.isRepack } };
}

function parseLanguages(v: unknown): ArrLanguage[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_LANGUAGES) return null;
  const out: ArrLanguage[] = [];
  for (const l of v) {
    if (!l || typeof l !== 'object' || !isWhole((l as Body).id) || !isText((l as Body).name)) return null;
    out.push({ id: (l as Body).id as number, name: (l as Body).name as string });
  }
  return out;
}

function parseOverrideChoice(b: Body): { quality: ArrQualityModel; languages: ArrLanguage[] } | string {
  const quality = parseQuality(b.quality);
  if (!quality) return 'Choose a quality';
  const languages = parseLanguages(b.languages);
  if (!languages) return 'Choose at least one language';
  return { quality, languages };
}

export function parseSonarrGrab(body: unknown): Parsed<SonarrGrabRequest> {
  const parsed = parseBase(body);
  if (!parsed.ok) return parsed;
  const { body: b, base } = parsed;

  if (has(b, 'shouldOverride')) {
    if (b.shouldOverride !== true || has(b, 'episodeId') || has(b, 'seasonNumber')) return { ok: false, error: 'Invalid manual grab' };
    if (!isId(b.seriesId)) return { ok: false, error: 'Choose a series' };
    const ids = b.episodeIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_EPISODES || !ids.every(isId) || new Set(ids).size !== ids.length) {
      return { ok: false, error: 'Choose at least one episode' };
    }
    const choice = parseOverrideChoice(b);
    if (typeof choice === 'string') return { ok: false, error: choice };
    return { ok: true, request: { ...base, shouldOverride: true, seriesId: b.seriesId, episodeIds: ids as number[], ...choice } };
  }
  // Fields only a manual grab sends would be ignored by Sonarr without it: refuse them.
  if (has(b, 'episodeIds') || has(b, 'quality') || has(b, 'languages')) return { ok: false, error: 'Invalid grab' };

  if (has(b, 'episodeId')) {
    if (!isId(b.episodeId) || has(b, 'seriesId') || has(b, 'seasonNumber')) return { ok: false, error: 'Invalid episode' };
    return { ok: true, request: { ...base, episodeId: b.episodeId } };
  }
  if (has(b, 'seriesId') || has(b, 'seasonNumber')) {
    if (!isId(b.seriesId) || !isWhole(b.seasonNumber)) return { ok: false, error: 'Invalid season' };
    return { ok: true, request: { ...base, seriesId: b.seriesId, seasonNumber: b.seasonNumber } };
  }
  return { ok: true, request: base };
}

export function parseRadarrGrab(body: unknown): Parsed<RadarrGrabRequest> {
  const parsed = parseBase(body);
  if (!parsed.ok) return parsed;
  const { body: b, base } = parsed;

  if (has(b, 'shouldOverride')) {
    if (b.shouldOverride !== true) return { ok: false, error: 'Invalid manual grab' };
    if (!isId(b.movieId)) return { ok: false, error: 'Choose a movie' };
    const choice = parseOverrideChoice(b);
    if (typeof choice === 'string') return { ok: false, error: choice };
    return { ok: true, request: { ...base, shouldOverride: true, movieId: b.movieId, ...choice } };
  }
  if (has(b, 'quality') || has(b, 'languages')) return { ok: false, error: 'Invalid grab' };

  if (has(b, 'movieId')) {
    if (!isId(b.movieId)) return { ok: false, error: 'Invalid movie' };
    return { ok: true, request: { ...base, movieId: b.movieId } };
  }
  return { ok: true, request: base };
}

/** Lidarr's grab (POST /api/v1/release): the release and, optionally, another download client. */
export function parseLidarrGrab(body: unknown): Parsed<{ guid: string; indexerId: number; downloadClientId?: number }> {
  const parsed = parseBase(body);
  return parsed.ok ? { ok: true, request: parsed.base } : parsed;
}

/** What a failed grab means to the user; the UI acts on `code`. */
export type GrabErrorCode = 'expired' | 'unmatched' | 'indexer' | 'client';

const UNMATCHED = {
  sonarr: "Sonarr couldn't tell which series and episodes this release is for. Choose them in Manual grab.",
  radarr: "Radarr couldn't tell which movie this release is for. Choose it in Manual grab.",
} as const;

/**
 * Turn a failed grab into Helprr's own words. Only the *arr's `message` is
 * read, and only to recognise it: it (and the stack trace in `description`)
 * is never passed on. Anything not recognised keeps the generic answer.
 */
export function grabErrorResponse(error: unknown, service: 'sonarr' | 'radarr'): NextResponse {
  if (isAxiosError(error) && error.response) {
    const { status, data } = error.response;
    const message = data && typeof data === 'object' && typeof (data as Body).message === 'string' ? (data as Body).message as string : '';
    const reply = (code: GrabErrorCode, text: string, httpStatus: number) => {
      console.error(`[api] Grab failed (${code}): ${status} ${message.slice(0, 200)}`);
      return NextResponse.json({ error: text, code }, { status: httpStatus });
    };
    if (status === 404 && /couldn't find requested release in cache/i.test(message)) {
      return reply('expired', 'This result has expired. Search again.', 410);
    }
    if (status === 404 && /unable to find matching/i.test(message)) return reply('unmatched', UNMATCHED[service], 422);
    if (status === 404 && /unable to parse episodes/i.test(message)) {
      return reply('unmatched', "Sonarr couldn't tell which episodes this release is for. Choose them in Manual grab.", 422);
    }
    if (status === 409 && /getting release from indexer failed/i.test(message)) {
      // Also a download client's or the blocklist's refusal: the *arr sends all three as this.
      return reply('indexer', "The release couldn't be fetched, or the download client refused it. Try another one.", 502);
    }
    if (/download client/i.test(message)) {
      return reply('client', "The download client didn't take this release. Check it, or try another release.", 502);
    }
  }
  return upstreamErrorResponse(error, 'Failed to grab release');
}
