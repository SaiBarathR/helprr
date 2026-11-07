import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { endTonightSession, tonightView } from '@/lib/tonight-pick';
import { loadTonightForUser, tonightUnavailable } from '@/lib/tonight-pick-access';

type Context = { params: Promise<{ id: string }> };

// Polled every ~2 s while a pick is open on screen.
async function getHandler(_request: NextRequest, { params }: Context): Promise<NextResponse> {
  const auth = await requireUserCapability('random.view');
  if (!auth.ok) return auth.response;
  const loaded = await loadTonightForUser((await params).id, auth.user);
  if (!loaded.ok) return loaded.response;
  return NextResponse.json(tonightView(loaded.state, auth.user.id));
}

// Only the starter can end a pick.
async function deleteHandler(_request: NextRequest, { params }: Context): Promise<NextResponse> {
  const auth = await requireUserCapability('random.view');
  if (!auth.ok) return auth.response;
  const loaded = await loadTonightForUser((await params).id, auth.user);
  if (!loaded.ok) return loaded.response;
  if (loaded.state.meta.starterId !== auth.user.id) {
    return NextResponse.json({ error: 'Only the person who started this pick can end it' }, { status: 403 });
  }
  try {
    const ended = await endTonightSession(loaded.redis, loaded.state);
    return NextResponse.json(tonightView(ended, auth.user.id));
  } catch (error) {
    return tonightUnavailable(error);
  }
}

export const GET = withApiLogging(getHandler, 'api/tonight/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/tonight/[id]');
