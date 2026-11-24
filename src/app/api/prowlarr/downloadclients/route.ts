import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

export interface ProwlarrDownloadClientSummary {
  id: number;
  name: string;
  protocol: string;
}

/**
 * Prowlarr's enabled download clients, for picking one on a grab. Each one's
 * `fields` hold its address and password, so only the id, name and protocol
 * leave the server, in Prowlarr's priority order.
 */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

  try {
    const clients = await (await getProwlarrClient()).getDownloadClients();
    const summaries: ProwlarrDownloadClientSummary[] = (Array.isArray(clients) ? clients : [])
      .filter((client) => client?.enable === true && Number.isInteger(client.id))
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || String(a.name).localeCompare(String(b.name)))
      .map(({ id, name, protocol }) => ({ id, name: String(name ?? ''), protocol: String(protocol ?? '') }));
    return NextResponse.json(summaries);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch download clients');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/downloadclients');
