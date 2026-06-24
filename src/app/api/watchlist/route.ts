import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import {
  ensureTagIds,
  isValidMediaType,
  isValidSource,
  normalizeTagName,
} from '@/lib/watchlist-helpers';
import {
  getLibraryLookups,
  resolveHrefFromLookups,
  type LibraryHrefLookups,
} from '@/lib/watchlist-library-lookup';

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
}

const MAX_TITLE_LEN = 200;
const MAX_POSTER_URL_LEN = 500;
const MAX_OVERVIEW_LEN = 2000;

function validatePosterUrl(raw: string): string | null {
  if (raw.length > MAX_POSTER_URL_LEN) return null;
  // Allow only http(s) — `<img src="javascript:...">` doesn't execute in
  // modern browsers, but `data:` and unknown schemes are still bytes we'd
  // rather not store unbounded.
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

function serialize(
  item: {
    id: string;
    userId?: string | null;
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
    href: resolveHrefFromLookups(item.source, item.externalId, item.mediaType, lookups),
  };
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('watchlist.view');
  if (!auth.ok) return auth.response;

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
      // Each user sees only their own watchlist (admins included — it's personal).
      userId: auth.user.id,
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
      ? await getLibraryLookups(needed)
      : null;

  return NextResponse.json(items.map((i) => serialize(i, lookups)));
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('watchlist.edit');
  if (!auth.ok) return auth.response;

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
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE_LEN) : '';

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

  // `null` means "clear it"; missing field means "leave it alone" (handled below).
  // Strings get scheme-validated (posterUrl) or length-capped (overview) before
  // hitting the DB — these end up rendered in the UI / persisted as TEXT.
  let year: number | null | undefined;
  if (body.year === undefined) year = undefined;
  else if (typeof body.year === 'number' && Number.isFinite(body.year)) year = body.year;
  else year = null;
  let posterUrl: string | null | undefined;
  if (body.posterUrl === undefined) posterUrl = undefined;
  else if (typeof body.posterUrl === 'string') {
    const validated = validatePosterUrl(body.posterUrl);
    if (validated === null) {
      return NextResponse.json({ error: 'Invalid posterUrl' }, { status: 400 });
    }
    posterUrl = validated;
  } else posterUrl = null;
  const overview =
    body.overview === undefined
      ? undefined
      : typeof body.overview === 'string'
        ? body.overview.slice(0, MAX_OVERVIEW_LEN)
        : null;
  const rating =
    body.rating === undefined
      ? undefined
      : typeof body.rating === 'number' && Number.isFinite(body.rating)
        ? Math.max(0, Math.min(100, body.rating))
        : null;
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : null;

  const userId = auth.user.id;
  const tagIds = tags ? await ensureTagIds(userId, tags) : null;

  const uniqueWhere = {
    userId_source_externalId_mediaType: { userId, source, externalId, mediaType },
  };

  const existing = await prisma.watchlistItem.findUnique({ where: uniqueWhere });

  const item = await prisma.watchlistItem.upsert({
    where: uniqueWhere,
    create: {
      userId,
      source,
      externalId,
      mediaType,
      title,
      year: year ?? null,
      posterUrl: posterUrl ?? null,
      overview: overview ?? null,
      rating: rating ?? null,
      tags: tagIds ? { connect: tagIds.map((id) => ({ id })) } : undefined,
    },
    update: {
      title,
      ...(year !== undefined ? { year } : {}),
      ...(posterUrl !== undefined ? { posterUrl } : {}),
      ...(overview !== undefined ? { overview } : {}),
      ...(rating !== undefined ? { rating } : {}),
      ...(tagIds ? { tags: { set: tagIds.map((id) => ({ id })) } } : {}),
    },
    include: { tags: true },
  });

  return NextResponse.json({ item: serialize(item), created: !existing });
}

async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('watchlist.edit');
  if (!auth.ok) return auth.response;

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

  // Only ever wipes the caller's own watchlist.
  const result = await prisma.watchlistItem.deleteMany({ where: { userId: auth.user.id } });
  return NextResponse.json({ ok: true, count: result.count });
}

export const GET = withApiLogging(getHandler, 'api/watchlist');
export const POST = withApiLogging(postHandler, 'api/watchlist');
export const DELETE = withApiLogging(deleteHandler, 'api/watchlist');
