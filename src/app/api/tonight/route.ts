import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { getRedisClient } from '@/lib/redis';
import {
  TONIGHT_MAX_INVITEES,
  allowTonightStart,
  buildTonightTitles,
  canJoinTonight,
  createTonightSession,
  sendTonightInvites,
  tonightLink,
  tonightView,
} from '@/lib/tonight-pick';
import { tonightUnavailable } from '@/lib/tonight-pick-access';
import { isRandomRuntime, parseRandomGenres } from '@/lib/random-watch-filters';
import type { TonightFilters } from '@/types/tonight';

const TYPES: ReadonlySet<string> = new Set(['movie', 'series', 'any']);
const WATCH: ReadonlySet<string> = new Set(['all', 'unwatched']);

// Starts a Tonight pick from the Random filters and invites household members.
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('random.view');
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.type !== 'string' || !TYPES.has(body.type) || typeof body.watch !== 'string' || !WATCH.has(body.watch)) {
    return NextResponse.json({ error: 'Invalid filters' }, { status: 400 });
  }
  const genres = body.genres === undefined ? [] : parseRandomGenres(body.genres);
  if (!genres || (body.runtime !== undefined && !isRandomRuntime(body.runtime))) {
    return NextResponse.json({ error: 'Invalid filters' }, { status: 400 });
  }
  const filters: TonightFilters = {
    type: body.type as TonightFilters['type'],
    watch: body.watch as TonightFilters['watch'],
    genres,
    // As on Random, a series-only pick has no length preset.
    runtime: body.type !== 'series' && isRandomRuntime(body.runtime) ? body.runtime : 'any',
  };
  const inviteeIds = Array.isArray(body.inviteeIds)
    ? [...new Set(body.inviteeIds.filter((v): v is string => typeof v === 'string'))]
    : [];
  if (inviteeIds.length === 0 || inviteeIds.length > TONIGHT_MAX_INVITEES || inviteeIds.includes(auth.user.id)) {
    return NextResponse.json({ error: `Invite between 1 and ${TONIGHT_MAX_INVITEES} other people` }, { status: 400 });
  }
  if (!canJoinTonight(auth.user, filters.type)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const invitees = await prisma.user.findMany({ where: { id: { in: inviteeIds } } });
  // Fail closed: one unknown, disabled or unable invitee refuses the whole start.
  if (invitees.length !== inviteeIds.length || invitees.some((u) => !canJoinTonight(u, filters.type))) {
    return NextResponse.json({ error: 'Someone you picked can’t join this pick' }, { status: 400 });
  }

  let redis: Awaited<ReturnType<typeof getRedisClient>>;
  try {
    redis = await getRedisClient();
    if (!(await allowTonightStart(redis, auth.user.id))) {
      return NextResponse.json({ error: 'Too many picks started. Try again in a few minutes.' }, { status: 429 });
    }
  } catch (error) {
    return tonightUnavailable(error);
  }

  const { titles, narrowed } = await buildTonightTitles(auth.user, invitees, filters);
  if (titles.length === 0) {
    return NextResponse.json({ error: 'Nothing downloaded matches this filter for everyone' }, { status: 422 });
  }

  const byId = new Map(invitees.map((u) => [u.id, u]));
  let state;
  try {
    state = await createTonightSession(redis, {
      starterId: auth.user.id,
      filters,
      invited: [
        { id: auth.user.id, name: auth.user.displayName },
        ...inviteeIds.map((id) => ({ id, name: byId.get(id)!.displayName })),
      ],
      titles,
      narrowed,
    });
  } catch (error) {
    return tonightUnavailable(error);
  }

  // Pushes go out in the background so the starter can begin swiping at once.
  void sendTonightInvites(state);

  return NextResponse.json({ id: state.meta.id, link: tonightLink(state.meta.id), view: tonightView(state, auth.user.id) }, { status: 201 });
}

export const POST = withApiLogging(postHandler, 'api/tonight');
