import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { joinTonightSession, tonightView } from '@/lib/tonight-pick';
import { loadTonightForUser, tonightUnavailable } from '@/lib/tonight-pick-access';

// An invited person opening the pick joins it, so a match then needs their yes too.
async function postHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireUserCapability('random.view');
  if (!auth.ok) return auth.response;
  const loaded = await loadTonightForUser((await params).id, auth.user);
  if (!loaded.ok) return loaded.response;
  try {
    const state = await joinTonightSession(loaded.redis, loaded.state, auth.user.id);
    return NextResponse.json(tonightView(state, auth.user.id));
  } catch (error) {
    return tonightUnavailable(error);
  }
}

export const POST = withApiLogging(postHandler, 'api/tonight/[id]/join');
