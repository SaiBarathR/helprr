import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { listFollows } from '@/lib/twitch/user-link';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  try {
    const follows = await listFollows(auth.user.id);
    return NextResponse.json({ connected: follows !== null, follows: follows ?? [] });
  } catch {
    return NextResponse.json({ error: 'Could not reach Twitch' }, { status: 502 });
  }
}

async function deleteHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  await prisma.twitchUserLink.deleteMany({ where: { userId: auth.user.id } });
  return NextResponse.json({ ok: true });
}

export const GET = withApiLogging(getHandler, 'api/twitch/follows', { logBodies: false });
export const DELETE = withApiLogging(deleteHandler, 'api/twitch/follows', { logBodies: false });
