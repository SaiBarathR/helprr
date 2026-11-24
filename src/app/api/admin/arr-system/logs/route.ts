import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { ARR_LOG_PAGE_SIZE } from '@/lib/arr-system';
import { parsePageNumber } from '@/lib/pagination';
import { NO_STORE, resolveSystemTarget, toLogPage } from '@/lib/server/arr-system';

const LEVELS = new Set(['warn', 'error']);

// One instance's recent warnings (and worse), newest first, a page at a time.
// Admins only: the lines name hosts, paths and titles, and are redacted of
// keys, passwords, passkeys and magnets before they leave (toLogPage).
async function getHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const params = request.nextUrl.searchParams;
  const page = parsePageNumber(params, { max: 1000 });
  const level = params.get('level') ?? 'warn';
  if (!LEVELS.has(level)) {
    return NextResponse.json({ error: 'level must be "warn" or "error"' }, { status: 400 });
  }
  try {
    const resolved = await resolveSystemTarget(params.get('instanceId'));
    if (!resolved.ok) return resolved.response;
    const { client, apiKey } = resolved.target;
    const raw = await client.getLogs({ page, pageSize: ARR_LOG_PAGE_SIZE, level });
    return NextResponse.json(toLogPage(raw, page, apiKey), { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch logs');
  }
}

export const GET = withApiLogging(getHandler, 'api/admin/arr-system/logs');
