import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { PROWLARR_SCOPE, resolveReleaseToken, type ProwlarrReleaseRef } from '@/lib/release-tokens';

const EXPIRED = 'This result has expired. Search again.';
const MAX_ID = 2_147_483_647;

/**
 * Send one searched release to Prowlarr's own download client, or the one
 * picked. Takes only the token from the search; Prowlarr's response, which
 * holds the release's links, is not passed on.
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
  const { id, downloadClientId } = (body ?? {}) as { id?: unknown; downloadClientId?: unknown };
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
    return NextResponse.json({ error: 'Invalid release' }, { status: 400 });
  }
  // None (or null) leaves the choice to Prowlarr.
  const clientId = downloadClientId ?? undefined;
  if (clientId !== undefined && !(Number.isInteger(clientId) && (clientId as number) > 0 && (clientId as number) <= MAX_ID)) {
    return NextResponse.json({ error: 'Invalid download client' }, { status: 400 });
  }

  try {
    const release = await resolveReleaseToken<ProwlarrReleaseRef>(PROWLARR_SCOPE, auth.user.id, id);
    if (!release) return NextResponse.json({ error: EXPIRED }, { status: 410 });

    const client = await getProwlarrClient();
    if (clientId !== undefined) {
      // Prowlarr hands the release to whichever client the id names, even a
      // disabled one or one for the other protocol, so that is checked here.
      const usable = (await client.getDownloadClients()).some((downloadClient) =>
        downloadClient.id === clientId && downloadClient.enable && downloadClient.protocol === release.protocol);
      if (!usable) {
        return NextResponse.json({ error: 'That download client is gone, disabled or for the other protocol. Pick again.' }, { status: 400 });
      }
    }
    // The token also holds the release's links: only the guid and indexer go to Prowlarr.
    await client.grabRelease({ guid: release.guid, indexerId: release.indexerId, downloadClientId: clientId as number | undefined });
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
