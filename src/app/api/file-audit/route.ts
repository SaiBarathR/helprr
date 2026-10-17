import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { upstreamErrorResponse } from '@/lib/api-error';
import { parsePageParams } from '@/lib/pagination';

// Admin-only viewer for the unified file/destructive operation trail.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const sp = request.nextUrl.searchParams;
    const { page, pageSize } = parsePageParams(sp, { defaultSize: 50, maxSize: 100 });

    const [records, total] = await Promise.all([
      prisma.fileOperationAudit.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.fileOperationAudit.count(),
    ]);

    return NextResponse.json(
      { page, pageSize, total, records },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to load audit log');
  }
}

export const GET = withApiLogging(getHandler, 'api/file-audit');
