import { NextRequest, NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { authorizeApiTokenRequest } from '@/lib/api-tokens';
import { buildStatusQueue } from '@/lib/status-api';

// GET /api/v1/queue: the combined Sonarr/Radarr/Lidarr download queue, read-only,
// for a personal API token with the activity.view scope (docs-site:
// status-api.md). Only `Authorization: Bearer hlp_…` opens it, never a session.

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await authorizeApiTokenRequest(request);
  if (!auth.ok) return auth.response;
  if (!auth.scopes.has('activity.view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    return NextResponse.json(await buildStatusQueue(auth.user), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error(`[StatusApi] Failed to read the queue: ${error instanceof Error ? error.name : 'unknown error'}`);
    return NextResponse.json({ error: 'Failed to read the queue' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const GET = withApiLogging(getHandler, 'api/v1/queue', { logBodies: false });
