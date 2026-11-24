import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/**
 * Test one indexer proxy. The server reads the proxy and sends it back to
 * Prowlarr, so the browser never handles its settings, and a failure is a
 * fixed message: Prowlarr's text can name the proxy's host.
 */
async function postHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!/^\d{1,10}$/.test(id) || Number(id) === 0) {
    return NextResponse.json({ error: 'Invalid proxy id' }, { status: 400 });
  }

  try {
    const client = await getProwlarrClient();
    await client.testIndexerProxy(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Test failed');
  }
}

export const POST = withApiLogging(postHandler, 'api/prowlarr/indexerproxies/[id]/test');
