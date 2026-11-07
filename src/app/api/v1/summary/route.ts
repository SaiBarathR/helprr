import { NextRequest, NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { authorizeApiTokenRequest } from '@/lib/api-tokens';
import { buildStatusSummary } from '@/lib/status-api';

// GET /api/v1/summary: a personal API token's read-only status summary
// (docs-site: status-api.md). Only `Authorization: Bearer hlp_…` opens it,
// never a session; the proxy lets it through for that header alone. Each
// section is there only when the token has its scope and the owner still holds it.

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await authorizeApiTokenRequest(request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await buildStatusSummary(auth.user, auth.scopes), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error(`[StatusApi] Failed to build the summary: ${error instanceof Error ? error.name : 'unknown error'}`);
    return NextResponse.json({ error: 'Failed to build the summary' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const GET = withApiLogging(getHandler, 'api/v1/summary', { logBodies: false });
