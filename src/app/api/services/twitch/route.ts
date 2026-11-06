import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { isNonEmptyString, resolveApiKeyForService } from '@/lib/service-connection-secrets';
import { requestTwitchAppToken, TwitchCredentialsRejectedError, TWITCH_HELIX_URL } from '@/lib/twitch/helix';
import { encryptTwitchToken } from '@/lib/twitch/token-cipher';
import { recordSecurityEvent, serviceTargetLabel } from '@/lib/security-audit';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!isNonEmptyString(body?.clientId) || !isNonEmptyString(body?.clientSecret)) {
    return NextResponse.json({ error: 'clientId and clientSecret are required' }, { status: 400 });
  }

  const clientId = body.clientId.trim();
  const clientSecret = await resolveApiKeyForService('TWITCH', body.clientSecret.trim(), TWITCH_HELIX_URL);
  if (clientSecret === null) {
    return NextResponse.json({ error: 'Enter the client secret again' }, { status: 400 });
  }

  // Proven before saving, so a typo cannot leave a connection that fails on every poll.
  let token;
  try {
    token = await requestTwitchAppToken(clientId, clientSecret);
  } catch (error) {
    if (error instanceof TwitchCredentialsRejectedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Could not reach Twitch' }, { status: 502 });
  }

  const data = {
    url: TWITCH_HELIX_URL,
    apiKey: clientSecret,
    externalUrl: clientId,
    accessToken: encryptTwitchToken(token.accessToken),
    tokenExpiresAt: token.expiresAt,
  };
  const existing = await prisma.serviceConnection.findFirst({ where: { type: 'TWITCH' } });
  const saved = existing
    ? await prisma.serviceConnection.update({ where: { id: existing.id }, data })
    : await prisma.serviceConnection.create({ data: { type: 'TWITCH', label: 'Twitch', ...data } });
  // The app token is refreshed on every save; only the credentials typed in count.
  const fields = existing
    ? [...(existing.externalUrl !== clientId ? ['clientId'] : []), ...(existing.apiKey !== clientSecret ? ['clientSecret'] : [])]
    : ['clientId', 'clientSecret'];
  if (fields.length > 0) {
    await recordSecurityEvent(request, {
      actor: auth.user,
      action: existing ? 'SERVICE_UPDATED' : 'SERVICE_CREATED',
      targetType: 'service',
      targetId: saved.id,
      targetLabel: serviceTargetLabel('TWITCH', 'Twitch'),
      fields,
    });
  }
  return NextResponse.json({ ok: true });
}

async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  const deleted = await prisma.serviceConnection.deleteMany({ where: { type: 'TWITCH' } });
  if (deleted.count > 0) {
    await recordSecurityEvent(request, {
      actor: auth.user,
      action: 'SERVICE_DELETED',
      targetType: 'service',
      targetLabel: serviceTargetLabel('TWITCH', 'Twitch'),
    });
  }
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging(postHandler, 'api/services/twitch', { logBodies: false });
export const DELETE = withApiLogging(deleteHandler, 'api/services/twitch', { logBodies: false });
