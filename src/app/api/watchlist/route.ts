import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import {
  isValidMediaType,
  isValidSource,
  normalizeTagName,
  pickTagColor,
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

const REMINDER_TAG = 'reminder';

function parseReminderAt(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined; // no change
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' && !(raw instanceof Date)) return undefined;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

async function ensureTagIds(rawNames: string[]): Promise<string[]> {
  const cleaned = Array.from(
    new Set(
      rawNames
        .map((t) => normalizeTagName(t))
        .filter((t) => t.length > 0 && t.length <= 50)
    )
  );
  if (cleaned.length === 0) return [];

  const existing = await prisma.watchlistTag.findMany({
    where: { name: { in: cleaned } },
    select: { id: true, name: true },
  });
  const existingByName = new Map(existing.map((t) => [t.name, t.id]));
  const toCreate = cleaned.filter((n) => !existingByName.has(n));
  if (toCreate.length > 0) {
    await prisma.watchlistTag.createMany({
      data: toCreate.map((name) => ({ name, color: pickTagColor(name) })),
      skipDuplicates: true,
    });
    const fresh = await prisma.watchlistTag.findMany({
      where: { name: { in: toCreate } },
      select: { id: true, name: true },
    });
    for (const t of fresh) existingByName.set(t.name, t.id);
  }

  return cleaned.map((n) => existingByName.get(n)!).filter(Boolean);
}

interface LibraryHrefLookups {
  radarrByTmdbId: Map<number, number>;
  sonarrByTvdbId: Map<number, number>;
  sonarrByTmdbId: Map<number, number>;
}

async function buildLibraryHrefLookups(needed: {
  tmdbMovie: boolean;
  tvdbSeries: boolean;
  tmdbSeries: boolean;
}): Promise<LibraryHrefLookups> {
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

  return { radarrByTmdbId, sonarrByTvdbId, sonarrByTmdbId };
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

  const items = await prisma.watchlistItem.findMany({
    where: {
      ...(tag ? { tags: { some: { id: tag } } } : {}),
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
  const posterUrl = typeof body.posterUrl === 'string' ? body.posterUrl : null;
  const overview = typeof body.overview === 'string' ? body.overview : null;
  const rating =
    typeof body.rating === 'number' && Number.isFinite(body.rating)
      ? Math.max(0, Math.min(100, body.rating))
      : null;
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : [];
  const reminderAt = parseReminderAt(body.reminderAt);

  // Auto-include the 'reminder' tag whenever a reminder date is set, and
  // drop it when the reminder is explicitly cleared, so the UI can filter
  // watchlist views by tag without callers having to manage the tag.
  const tagSet = new Set(tags.map((t) => normalizeTagName(t)).filter(Boolean));
  if (reminderAt instanceof Date) tagSet.add(REMINDER_TAG);
  else if (reminderAt === null) tagSet.delete(REMINDER_TAG);

  const tagIds = await ensureTagIds(Array.from(tagSet));

  const existing = await prisma.watchlistItem.findUnique({
    where: { source_externalId_mediaType: { source, externalId, mediaType } },
  });

  // Setting a new reminderAt clears any previous "notified" stamp so the
  // poller treats it as a fresh pending reminder.
  const reminderNotifiedAtUpdate =
    reminderAt === undefined ? undefined : reminderAt === null ? null : null;

  const item = await prisma.watchlistItem.upsert({
    where: { source_externalId_mediaType: { source, externalId, mediaType } },
    create: {
      source,
      externalId,
      mediaType,
      title,
      year,
      posterUrl,
      overview,
      rating,
      reminderAt: reminderAt instanceof Date ? reminderAt : null,
      tags: { connect: tagIds.map((id) => ({ id })) },
    },
    update: {
      title,
      year,
      posterUrl: posterUrl ?? undefined,
      overview: overview ?? undefined,
      rating: rating ?? undefined,
      ...(reminderAt !== undefined
        ? { reminderAt, reminderNotifiedAt: reminderNotifiedAtUpdate }
        : {}),
      tags: { set: tagIds.map((id) => ({ id })) },
    },
    include: { tags: true },
  });

  return NextResponse.json({ item: serialize(item), created: !existing });
}

async function deleteHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const result = await prisma.watchlistItem.deleteMany({});
  return NextResponse.json({ ok: true, count: result.count });
}

export const GET = withApiLogging(getHandler, 'api/watchlist');
export const POST = withApiLogging(postHandler, 'api/watchlist');
export const DELETE = withApiLogging(deleteHandler, 'api/watchlist');
