import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { isNonEmptyString } from '@/lib/service-connection-secrets';
import { encryptTwitchToken } from '@/lib/twitch/token-cipher';
import { storedApiKey, verifyYoutubeKey, YOUTUBE_API_URL, YoutubeKeyRejectedError, YoutubeQuotaError } from '@/lib/youtube/api';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!isNonEmptyString(body?.apiKey)) return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
  const apiKey = body.apiKey.trim();

  // Proven before saving, so a typo cannot leave a connection that fails on every poll.
  try {
    await verifyYoutubeKey(apiKey);
  } catch (error) {
    if (error instanceof YoutubeKeyRejectedError) return NextResponse.json({ error: error.message }, { status: 400 });
    // Google only counts quota for a key it accepts, so a spent key is still a real one.
    if (!(error instanceof YoutubeQuotaError)) return NextResponse.json({ error: 'Could not reach YouTube' }, { status: 502 });
  }

  // A new key can belong to another project, whose quota the old count says nothing about.
  const keyChanged = (await storedApiKey()) !== apiKey;

  // Connection keys are plain text by default. This one is encrypted, and only its owner reads it.
  const data = { url: YOUTUBE_API_URL, apiKey: encryptTwitchToken(apiKey) };
  const existing = await prisma.serviceConnection.findFirst({ where: { type: 'YOUTUBE' } });
  if (existing) await prisma.serviceConnection.update({ where: { id: existing.id }, data });
  else await prisma.serviceConnection.create({ data: { type: 'YOUTUBE', label: 'YouTube', ...data } });
  if (keyChanged) await prisma.youtubeSettings.updateMany({ data: { quotaUsed: 0, quotaSearches: 0 } });
  return NextResponse.json({ ok: true });
}

async function deleteHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  await prisma.serviceConnection.deleteMany({ where: { type: 'YOUTUBE' } });
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging(postHandler, 'api/services/youtube', { logBodies: false });
export const DELETE = withApiLogging(deleteHandler, 'api/services/youtube', { logBodies: false });
