import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { castTonightVote, tonightView } from '@/lib/tonight-pick';
import { loadTonightForUser, tonightUnavailable } from '@/lib/tonight-pick-access';

// One final yes/no on one title. Answers with the viewer's updated view, so the
// swiper learns about a match without waiting for the next poll.
async function postHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireUserCapability('random.view');
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const loaded = await loadTonightForUser((await params).id, auth.user);
  if (!loaded.ok) return loaded.response;
  const { index, yes } = body;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= loaded.state.meta.titles.length || typeof yes !== 'boolean') {
    return NextResponse.json({ error: 'Invalid vote' }, { status: 400 });
  }
  try {
    const state = await castTonightVote(loaded.redis, loaded.state, auth.user.id, index, yes);
    return NextResponse.json(tonightView(state, auth.user.id));
  } catch (error) {
    return tonightUnavailable(error);
  }
}

export const POST = withApiLogging(postHandler, 'api/tonight/[id]/vote');
