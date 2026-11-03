import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { isNonEmptyString } from '@/lib/service-connection-secrets';
import { storedApiKey, verifyYoutubeKey, YoutubeKeyRejectedError, YoutubeQuotaError } from '@/lib/youtube/api';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  // A typed-in key is tested as it stands; with none, the saved connection is.
  const apiKey = isNonEmptyString(body?.apiKey) ? body.apiKey.trim() : await storedApiKey();
  if (!apiKey) return NextResponse.json({ success: false, error: 'Enter an API key' });
  try {
    await verifyYoutubeKey(apiKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    const known = error instanceof YoutubeKeyRejectedError || error instanceof YoutubeQuotaError;
    return NextResponse.json({ success: false, error: known ? error.message : 'Could not reach YouTube' });
  }
}

export const POST = withApiLogging(postHandler, 'api/services/youtube/test', { logBodies: false });
