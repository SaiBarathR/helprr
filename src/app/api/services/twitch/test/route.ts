import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { isNonEmptyString, resolveApiKeyForService } from '@/lib/service-connection-secrets';
import { helixGet, requestTwitchAppToken, TwitchCredentialsRejectedError, TWITCH_HELIX_URL, verifyTwitchAppToken } from '@/lib/twitch/helix';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    // Typed-in values are tested as they stand; with none, the saved connection is.
    if (isNonEmptyString(body?.clientId) && isNonEmptyString(body?.clientSecret)) {
      const clientSecret = await resolveApiKeyForService('TWITCH', body.clientSecret.trim(), TWITCH_HELIX_URL);
      if (clientSecret === null) {
        return NextResponse.json({ success: false, error: 'Enter the client secret again' });
      }
      await requestTwitchAppToken(body.clientId.trim(), clientSecret);
    } else {
      await verifyTwitchAppToken();
      await helixGet('/users', { login: 'twitchdev' });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof TwitchCredentialsRejectedError ? error.message : 'Could not reach Twitch',
    });
  }
}

export const POST = withApiLogging(postHandler, 'api/services/twitch/test', { logBodies: false });
