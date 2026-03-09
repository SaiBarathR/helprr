import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';

const VALID_PRIORITIES = new Set([0, 1, 6, 7]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const startedAt = performance.now();

  try {
    const { hash } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'malformed JSON' }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'malformed JSON' }, { status: 400 });
    }

    const { ids, priority } = body as { ids: unknown; priority: unknown };

    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(id) && id >= 0)) {
      return NextResponse.json({ error: 'ids must be a non-empty array of non-negative integers' }, { status: 400 });
    }
    if (typeof priority !== 'number' || !Number.isInteger(priority) || !VALID_PRIORITIES.has(priority)) {
      return NextResponse.json({ error: 'priority must be 0, 1, 6, or 7' }, { status: 400 });
    }

    const parsedIds = ids as number[];
    const parsedPriority = priority as 0 | 1 | 6 | 7;

    const client = await getQBittorrentClient();
    await client.setFilePriority(hash, parsedIds, parsedPriority);

    logApiDuration('/api/qbittorrent/[hash]/files/priority', startedAt, {
      method: 'POST',
      fileCount: parsedIds.length,
      priority: parsedPriority,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiDuration('/api/qbittorrent/[hash]/files/priority', startedAt, { method: 'POST', failed: true });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to set file priority' },
      { status: 500 }
    );
  }
}
