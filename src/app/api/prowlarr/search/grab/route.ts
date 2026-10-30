import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { resolveReleaseToken } from '@/lib/prowlarr-release-tokens';

const EXPIRED = 'This result has expired. Search again.';

/**
 * Send one searched release to Prowlarr's own download client. Takes only the
 * token from the search; Prowlarr's response, which holds the release's links,
 * is not passed on.
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
    return NextResponse.json({ error: 'Invalid release' }, { status: 400 });
  }

  try {
    const release = await resolveReleaseToken(auth.user.id, id);
    if (!release) return NextResponse.json({ error: EXPIRED }, { status: 410 });

    const client = await getProwlarrClient();
    await client.grabRelease(release);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/download client/i.test(message) && /configured|available/i.test(message)) {
      return NextResponse.json({ error: 'Set up a download client in Prowlarr to grab from here' }, { status: 409 });
    }
    if (/try searching again/i.test(message)) return NextResponse.json({ error: EXPIRED }, { status: 410 });
    return upstreamErrorResponse(error, 'Grab failed');
  }
}

export const POST = withApiLogging(postHandler, 'api/prowlarr/search/grab');
