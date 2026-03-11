import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { parsePositiveIntParam } from '@/lib/request-parsing';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = request.nextUrl;
    const page = parsePositiveIntParam(searchParams.get('page'), { defaultValue: 1 });
    const pageSize = parsePositiveIntParam(searchParams.get('pageSize'), { defaultValue: 50, max: 200 });
    const unreadOnly = searchParams.get('unreadOnly') === 'true';

    if (page === null || pageSize === null) {
      return NextResponse.json({ error: 'Invalid pagination params' }, { status: 400 });
    }

    const where = unreadOnly ? { read: false } : {};

    const [records, totalRecords] = await Promise.all([
      prisma.notificationHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notificationHistory.count({ where }),
    ]);

    return NextResponse.json({ page, pageSize, totalRecords, records });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
