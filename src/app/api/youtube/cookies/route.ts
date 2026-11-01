import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { encryptTwitchToken } from '@/lib/twitch/token-cipher';
import { cleanCookiesFile } from '@/lib/youtube/cookies';
import { getYoutubeSettings } from '@/lib/youtube/settings';

/** Whether an account is set and last known good. The cookies themselves never leave. */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;

  const { cookies, cookiesValid, cookiesCheckedAt } = await getYoutubeSettings();
  return NextResponse.json({ set: Boolean(cookies), valid: cookiesValid, checkedAt: cookiesCheckedAt });
}

async function putHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { cookies?: unknown } | null;
  if (typeof body?.cookies !== 'string') return NextResponse.json({ error: 'Choose your cookies.txt file' }, { status: 400 });
  const result = cleanCookiesFile(body.cookies);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });

  await getYoutubeSettings();
  await prisma.youtubeSettings.update({
    where: { id: 'singleton' },
    data: { cookies: encryptTwitchToken(result.cookies), cookiesValid: null, cookiesCheckedAt: null },
  });
  return NextResponse.json({ ok: true });
}

async function deleteHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;

  await prisma.youtubeSettings.updateMany({ data: { cookies: null, cookiesValid: null, cookiesCheckedAt: null } });
  return NextResponse.json({ ok: true });
}

export const GET = withApiLogging(getHandler, 'api/youtube/cookies');
export const PUT = withApiLogging(putHandler, 'api/youtube/cookies', { logBodies: false });
export const DELETE = withApiLogging(deleteHandler, 'api/youtube/cookies');
