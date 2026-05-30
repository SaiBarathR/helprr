import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function patchHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const isAdmin = auth.user.role === 'admin';
  let body: { label?: unknown };
  try {
    body = (await request.json()) as { label?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const labelRaw = body.label;
  if (labelRaw !== null && typeof labelRaw !== 'string') {
    return NextResponse.json({ error: 'label must be string or null' }, { status: 400 });
  }
  const label = labelRaw === null ? null : labelRaw.trim() || null;

  try {
    const existing = await prisma.session.findUnique({
      where: { id },
      select: { id: true, revokedAt: true, userId: true },
    });
    // Members may only touch their own sessions; report someone else's as 404
    // so the endpoint can't be used to probe which session ids exist.
    if (!existing || existing.revokedAt || (!isAdmin && existing.userId !== auth.user.id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await prisma.session.update({ where: { id }, data: { label } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Sessions] rename failed:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}

export const PATCH = withApiLogging(patchHandler, 'api/sessions/[id]');
