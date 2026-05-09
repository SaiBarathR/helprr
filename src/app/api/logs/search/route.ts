import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { searchLogs } from '@/lib/logger';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const params = request.nextUrl.searchParams;
  const entries = await searchLogs({
    q: params.get('q') || undefined,
    level: params.get('level') || undefined,
    source: params.get('source') || undefined,
    file: params.get('file') || undefined,
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
    limit: Number(params.get('limit') || 200),
  });

  return NextResponse.json({ entries });
}

export const GET = withApiLogging(getHandler, 'api/logs/search');
