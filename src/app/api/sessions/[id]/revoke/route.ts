import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, revokeSession } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const existing = await prisma.session.findUnique({
      where: { id },
      select: { id: true, revokedAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (existing.revokedAt) {
      return NextResponse.json({ revoked: 0 });
    }
    await revokeSession(id);
    return NextResponse.json({ revoked: 1, wasCurrent: id === auth.session.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler, 'api/sessions/[id]/revoke');
