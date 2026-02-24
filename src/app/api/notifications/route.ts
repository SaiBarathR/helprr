import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = request.nextUrl;
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');
    const unreadOnly = searchParams.get('unreadOnly') === 'true';

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
