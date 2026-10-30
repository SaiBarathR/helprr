import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { checkBrowserToken } from '@/lib/twitch/browser-token';
import { getTwitchSettings } from '@/lib/twitch/settings';
import { encryptTwitchToken } from '@/lib/twitch/token-cipher';

const TOKEN_PATTERN = /^[a-z0-9]{20,64}$/;

/** Never echoes the token, and neither route logs a body. */
async function putHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!TOKEN_PATTERN.test(token)) return NextResponse.json({ error: 'That is not a Twitch auth-token' }, { status: 400 });

  const valid = await checkBrowserToken(token);
  if (valid === false) return NextResponse.json({ error: 'Twitch rejected this token' }, { status: 400 });

  await getTwitchSettings();
  await prisma.twitchSettings.update({
    where: { id: 'singleton' },
    data: { browserAuthToken: encryptTwitchToken(token), browserAuthTokenValid: valid, browserAuthTokenCheckedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}

async function deleteHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  await getTwitchSettings();
  await prisma.twitchSettings.update({
    where: { id: 'singleton' },
    data: { browserAuthToken: null, browserAuthTokenValid: null, browserAuthTokenCheckedAt: null },
  });
  return NextResponse.json({ ok: true });
}

export const PUT = withApiLogging(putHandler, 'api/twitch/browser-token', { logBodies: false });
export const DELETE = withApiLogging(deleteHandler, 'api/twitch/browser-token', { logBodies: false });
