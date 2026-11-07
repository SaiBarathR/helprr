import { NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { getRedisClient } from '@/lib/redis';
import {
  canViewTonightTitles,
  claimTonightWinner,
  isInvited,
  isTonightSessionId,
  loadTonightSession,
  type TonightRedis,
  type TonightState,
} from '@/lib/tonight-pick';

export function tonightUnavailable(error: unknown): NextResponse {
  console.error('[Tonight] Redis unavailable:', error instanceof Error ? error.message : String(error));
  return NextResponse.json({ error: 'Tonight pick is unavailable right now' }, { status: 503 });
}

/**
 * Loads a pick for `user`, or the response that refuses them. A malformed id,
 * a missing (expired) pick and a pick they were not invited to all answer the
 * same 404, so an id never reveals that a pick exists.
 */
export async function loadTonightForUser(
  id: string,
  user: Pick<User, 'id' | 'role' | 'template' | 'permissions'>,
): Promise<{ ok: true; redis: TonightRedis; state: TonightState } | { ok: false; response: NextResponse }> {
  const notFound = { ok: false as const, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (!isTonightSessionId(id)) return notFound;
  let redis: TonightRedis;
  let state: TonightState | null;
  try {
    redis = await getRedisClient();
    state = await loadTonightSession(redis, id);
  } catch (error) {
    return { ok: false, response: tonightUnavailable(error) };
  }
  if (!state || !isInvited(state, user.id)) return notFound;
  if (!canViewTonightTitles(user, state)) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  try {
    state = await claimTonightWinner(redis, state);
  } catch (error) {
    return { ok: false, response: tonightUnavailable(error) };
  }
  return { ok: true, redis, state };
}
