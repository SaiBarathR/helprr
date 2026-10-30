import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { getTwitchSettings } from '@/lib/twitch/settings';

/** A flag the worker reads: the app never touches the tools itself. */
async function postHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  await getTwitchSettings();
  await prisma.twitchSettings.update({ where: { id: 'singleton' }, data: { toolUpdateRequestedAt: new Date() } });
  return NextResponse.json({ ok: true }, { status: 202 });
}

export const POST = withApiLogging(postHandler, 'api/twitch/worker/tools');
