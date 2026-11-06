import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { upstreamErrorResponse } from '@/lib/api-error';
import { parsePageParams } from '@/lib/pagination';

// Admin-only viewer for the security and admin audit trail. The coalescing key
// is internal and stays on the server. `hideFailedSignIns=1` drops LOGIN_FAILED
// and INVITE_LINK_FAILED rows, so a flood of guesses cannot push account and
// connection changes off the list.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const sp = request.nextUrl.searchParams;
    const { page, pageSize } = parsePageParams(sp, { defaultSize: 50, maxSize: 100 });
    const where: Prisma.SecurityAuditEventWhereInput = sp.get('hideFailedSignIns') === '1'
      ? { action: { notIn: ['LOGIN_FAILED', 'INVITE_LINK_FAILED'] } }
      : {};

    const [records, total] = await Promise.all([
      prisma.securityAuditEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        omit: { coalesceKey: true },
      }),
      prisma.securityAuditEvent.count({ where }),
    ]);

    return NextResponse.json(
      { page, pageSize, total, records },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to load the security log');
  }
}

export const GET = withApiLogging(getHandler, 'api/security-audit');
