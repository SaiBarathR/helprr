import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { searchLogs } from '@/lib/logger';
import { withApiLogging } from '@/lib/api-logger';

const DEFAULT_LIMIT = 200;
const MIN_LIMIT = 1;
const MAX_LIMIT = 1000;

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, parsed));
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const params = request.nextUrl.searchParams;
  const fromRaw = params.get('from') || undefined;
  const toRaw = params.get('to') || undefined;

  let fromMs: number | undefined;
  let toMs: number | undefined;
  if (fromRaw) {
    fromMs = Date.parse(fromRaw);
    if (!Number.isFinite(fromMs)) {
      return NextResponse.json({ error: 'Invalid from date' }, { status: 400 });
    }
  }
  if (toRaw) {
    toMs = Date.parse(toRaw);
    if (!Number.isFinite(toMs)) {
      return NextResponse.json({ error: 'Invalid to date' }, { status: 400 });
    }
  }
  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
    return NextResponse.json({ error: '`from` must be before `to`' }, { status: 400 });
  }

  const entries = await searchLogs({
    q: params.get('q') || undefined,
    level: params.get('level') || undefined,
    source: params.get('source') || undefined,
    file: params.get('file') || undefined,
    from: fromRaw,
    to: toRaw,
    limit: parseLimit(params.get('limit')),
  });

  return NextResponse.json({ entries });
}

export const GET = withApiLogging(getHandler, 'api/logs/search');
