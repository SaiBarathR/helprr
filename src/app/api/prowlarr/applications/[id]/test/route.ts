import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/**
 * Test one app. The server reads the app and sends it back to Prowlarr, so the
 * browser never handles its settings. A failure's text can quote the arr's URL,
 * so the client has cut that to the origin and only a fixed message is returned.
 */
async function postHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!/^\d{1,10}$/.test(id) || Number(id) === 0) {
    return NextResponse.json({ error: 'Invalid application id' }, { status: 400 });
  }

  try {
    const client = await getProwlarrClient();
    await client.testApplication(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Test failed');
  }
}

export const POST = withApiLogging(postHandler, 'api/prowlarr/applications/[id]/test');
