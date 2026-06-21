import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';

// Admin-only viewer for the FileOperationAudit trail (Manage Episodes/Files
// edits, deletes, imports). Paginated, newest first.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 50));

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
    const message = error instanceof Error ? error.message : 'Failed to load audit log';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/file-audit');
