import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import {
  ensureTagIds,
  isValidMediaType,
  isValidSource,
  normalizeTagName,
  watchlistHrefFor,
} from '@/lib/watchlist-helpers';
import { getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import type { RadarrMovie, SonarrSeries } from '@/types';

interface PostBody {
  source?: unknown;
  externalId?: unknown;
  mediaType?: unknown;
  title?: unknown;
  year?: unknown;
  posterUrl?: unknown;
  overview?: unknown;
  rating?: unknown;
  tags?: unknown;
  reminderAt?: unknown;
}

const REMINDER_INVALID = Symbol('reminderInvalid');
type ReminderResult = Date | null | undefined | typeof REMINDER_INVALID;

function parseReminderAt(raw: unknown): ReminderResult {
  if (raw === undefined) return undefined; // no change
  if (raw === null || raw === '') return null; // explicit clear
  if (typeof raw !== 'string' && !(raw instanceof Date)) return REMINDER_INVALID;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isFinite(d.getTime()) ? d : REMINDER_INVALID;
}

interface LibraryHrefLookups {
  radarrByTmdbId: Map<number, number>;
  sonarrByTvdbId: Map<number, number>;
  sonarrByTmdbId: Map<number, number>;
}

const LOOKUPS_TTL_MS = 5 * 60 * 1000;
let lookupsCache: { at: number; value: LibraryHrefLookups } | null = null;

async function buildLibraryHrefLookups(needed: {
  tmdbMovie: boolean;
  tvdbSeries: boolean;
  tmdbSeries: boolean;
}): Promise<LibraryHrefLookups> {
  const now = Date.now();
  if (lookupsCache && now - lookupsCache.at < LOOKUPS_TTL_MS) {
    return lookupsCache.value;
  }

  const needRadarr = needed.tmdbMovie;
  const needSonarr = needed.tvdbSeries || needed.tmdbSeries;

  const [movies, series] = await Promise.all([
    needRadarr
      ? (async () => {
          try {
            const c = await getRadarrClient();
            return await c.getMovies();
          } catch {
            return [] as RadarrMovie[];
          }
        })()
      : Promise.resolve([] as RadarrMovie[]),
    needSonarr
      ? (async () => {
          try {
            const c = await getSonarrClient();
            return await c.getSeries();
          } catch {
            return [] as SonarrSeries[];
          }
        })()
      : Promise.resolve([] as SonarrSeries[]),
  ]);

  const radarrByTmdbId = new Map<number, number>();
  for (const m of movies) {
    if (m.tmdbId) radarrByTmdbId.set(m.tmdbId, m.id);
  }
  const sonarrByTvdbId = new Map<number, number>();
  const sonarrByTmdbId = new Map<number, number>();
  for (const s of series) {
    if (s.tvdbId) sonarrByTvdbId.set(s.tvdbId, s.id);
    const tmdbId = (s as SonarrSeries & { tmdbId?: number }).tmdbId;
    if (tmdbId) sonarrByTmdbId.set(tmdbId, s.id);
  }

  const value: LibraryHrefLookups = { radarrByTmdbId, sonarrByTvdbId, sonarrByTmdbId };
  lookupsCache = { at: now, value };
  return value;
}

function resolveHref(
  source: string,
  externalId: string,
  mediaType: string,
  lookups: LibraryHrefLookups | null
): string | null {
  if (lookups) {
    const externalNum = Number.parseInt(externalId, 10);
    if (Number.isFinite(externalNum)) {
      if (source === 'TMDB' && mediaType === 'movie') {
        const id = lookups.radarrByTmdbId.get(externalNum);
        if (id) return `/movies/${id}`;
      }
      if (source === 'TVDB' && mediaType === 'series') {
        const id = lookups.sonarrByTvdbId.get(externalNum);
        if (id) return `/series/${id}`;
      }
      if (source === 'TMDB' && mediaType === 'series') {
        const id = lookups.sonarrByTmdbId.get(externalNum);
        if (id) return `/series/${id}`;
      }
    }
  }
  return watchlistHrefFor(source, externalId, mediaType);
}

function serialize(
  item: {
    id: string;
    source: string;
    externalId: string;
    mediaType: string;
    title: string;
    year: number | null;
    posterUrl: string | null;
    overview: string | null;
    rating: number | null;
    addedAt: Date;
    reminderAt: Date | null;
    reminderNotifiedAt: Date | null;
    tags: { id: string; name: string; color: string | null }[];
  },
  lookups: LibraryHrefLookups | null = null
) {
  return {
    ...item,
    addedAt: item.addedAt.toISOString(),
    reminderAt: item.reminderAt ? item.reminderAt.toISOString() : null,
    reminderNotifiedAt: item.reminderNotifiedAt ? item.reminderNotifiedAt.toISOString() : null,
    href: resolveHref(item.source, item.externalId, item.mediaType, lookups),
  };
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const tag = url.searchParams.get('tag')?.trim() || null;
  const q = url.searchParams.get('q')?.trim() || null;

  // Accept either a tag id (cuid, used by the in-app filter) or a tag name
  // (so shareable URLs like ?tag=family work).
  const tagFilter = tag
    ? { tags: { some: { OR: [{ id: tag }, { name: normalizeTagName(tag) }] } } }
    : {};

  const items = await prisma.watchlistItem.findMany({
    where: {
      ...tagFilter,
      ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
    },
    include: { tags: true },
    orderBy: { addedAt: 'desc' },
  });

  const needed = {
    tmdbMovie: items.some((i) => i.source === 'TMDB' && i.mediaType === 'movie'),
    tvdbSeries: items.some((i) => i.source === 'TVDB' && i.mediaType === 'series'),
    tmdbSeries: items.some((i) => i.source === 'TMDB' && i.mediaType === 'series'),
  };
  const lookups =
    needed.tmdbMovie || needed.tvdbSeries || needed.tmdbSeries
      ? await buildLibraryHrefLookups(needed)
      : null;

  return NextResponse.json(items.map((i) => serialize(i, lookups)));
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const source = typeof body.source === 'string' ? body.source.toUpperCase() : '';
  const externalId = typeof body.externalId === 'string' ? body.externalId
    : typeof body.externalId === 'number' ? String(body.externalId) : '';
  const mediaType = typeof body.mediaType === 'string' ? body.mediaType.toLowerCase() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!isValidSource(source)) {
    return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
  }
  if (!externalId) {
    return NextResponse.json({ error: 'externalId is required' }, { status: 400 });
  }
  if (!isValidMediaType(mediaType)) {
    return NextResponse.json({ error: 'Invalid mediaType' }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const year = typeof body.year === 'number' && Number.isFinite(body.year) ? body.year : null;
  // `null` means "clear it"; missing field means "leave it alone" (handled below).
  const posterUrl =
    body.posterUrl === undefined ? undefined : typeof body.posterUrl === 'string' ? body.posterUrl : null;
  const overview =
    body.overview === undefined ? undefined : typeof body.overview === 'string' ? body.overview : null;
  const rating =
    body.rating === undefined
      ? undefined
      : typeof body.rating === 'number' && Number.isFinite(body.rating)
        ? Math.max(0, Math.min(100, body.rating))
        : null;
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : null;
  const reminderResult = parseReminderAt(body.reminderAt);
  if (reminderResult === REMINDER_INVALID) {
    return NextResponse.json({ error: 'Invalid reminderAt' }, { status: 400 });
  }
  const reminderAt: Date | null | undefined = reminderResult;

  const tagIds = tags ? await ensureTagIds(tags) : null;

  const existing = await prisma.watchlistItem.findUnique({
    where: { source_externalId_mediaType: { source, externalId, mediaType } },
  });

  const item = await prisma.watchlistItem.upsert({
    where: { source_externalId_mediaType: { source, externalId, mediaType } },
    create: {
      source,
      externalId,
      mediaType,
      title,
      year,
      posterUrl: posterUrl ?? null,
      overview: overview ?? null,
      rating: rating ?? null,
      reminderAt: reminderAt instanceof Date ? reminderAt : null,
      tags: tagIds ? { connect: tagIds.map((id) => ({ id })) } : undefined,
    },
    update: {
      title,
      year,
      ...(posterUrl !== undefined ? { posterUrl } : {}),
      ...(overview !== undefined ? { overview } : {}),
      ...(rating !== undefined ? { rating } : {}),
      // Setting a new reminderAt resets notified+attempts so the poller treats
      // it as a fresh pending reminder. Clearing also resets both.
      ...(reminderAt !== undefined
        ? { reminderAt, reminderNotifiedAt: null, reminderAttempts: 0 }
        : {}),
      ...(tagIds ? { tags: { set: tagIds.map((id) => ({ id })) } } : {}),
    },
    include: { tags: true },
  });

  return NextResponse.json({ item: serialize(item), created: !existing });
}

async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  // Wipe-all is destructive enough that a stray GET-turned-DELETE or an
  // accidental fetch shouldn't trigger it. Require an explicit sentinel.
  let body: { confirm?: unknown };
  try {
    body = (await request.json()) as { confirm?: unknown };
  } catch {
    return NextResponse.json(
      { error: 'Body must be JSON with { confirm: "all" }' },
      { status: 400 }
    );
  }
  if (body?.confirm !== 'all') {
    return NextResponse.json(
      { error: 'Pass { confirm: "all" } to wipe the entire watchlist' },
      { status: 400 }
    );
  }

  const result = await prisma.watchlistItem.deleteMany({});
  return NextResponse.json({ ok: true, count: result.count });
}

export const GET = withApiLogging(getHandler, 'api/watchlist');
export const POST = withApiLogging(postHandler, 'api/watchlist');
export const DELETE = withApiLogging(deleteHandler, 'api/watchlist');
