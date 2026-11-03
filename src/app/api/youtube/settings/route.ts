import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { getYoutubeSettings } from '@/lib/youtube/settings';

const MIN_POLL_SECS = 300;
const MAX_POLL_SECS = 86_400;

// Named one by one: the settings row also holds the spare account, which never leaves.
async function publicSettings() {
  const { autoDownloadEnabled, pollVideosSecs } = await getYoutubeSettings();
  return { autoDownloadEnabled, pollVideosSecs };
}

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;
  return NextResponse.json(await publicSettings());
}

async function putHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  const { autoDownloadEnabled, pollVideosSecs } = body;
  const validPoll = typeof pollVideosSecs === 'number' && Number.isInteger(pollVideosSecs)
    && pollVideosSecs >= MIN_POLL_SECS && pollVideosSecs <= MAX_POLL_SECS;
  if (pollVideosSecs !== undefined && !validPoll) {
    return NextResponse.json({ error: `Check between every ${MIN_POLL_SECS / 60} minutes and once a day` }, { status: 400 });
  }

  await getYoutubeSettings();
  await prisma.youtubeSettings.update({
    where: { id: 'singleton' },
    data: {
      ...(typeof autoDownloadEnabled === 'boolean' ? { autoDownloadEnabled } : {}),
      ...(validPoll ? { pollVideosSecs } : {}),
    },
  });
  return NextResponse.json(await publicSettings());
}

export const GET = withApiLogging(getHandler, 'api/youtube/settings');
export const PUT = withApiLogging(putHandler, 'api/youtube/settings');
