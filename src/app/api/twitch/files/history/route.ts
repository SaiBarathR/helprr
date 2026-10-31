import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { parsePageParams } from '@/lib/pagination';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip, take } = parsePageParams(searchParams, { defaultSize: 30, maxSize: 60 });
  const q = searchParams.get('q')?.trim().slice(0, 100);
  const where = q
    ? { OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { streamer: { contains: q, mode: 'insensitive' as const } }] }
    : {};
  const [rows, total] = await Promise.all([
    prisma.twitchDeletedFile.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
    prisma.twitchDeletedFile.count({ where }),
  ]);
  return NextResponse.json({
    deletions: rows.map((row) => ({ ...row, freedBytes: Number(row.freedBytes) })),
    total,
    page,
    pageSize,
  });
}

export const GET = withApiLogging(getHandler, 'api/twitch/files/history');
