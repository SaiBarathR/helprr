import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function patchHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { id } = await params;
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
      select: { id: true, revokedAt: true },
    });
    if (!existing || existing.revokedAt) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await prisma.session.update({ where: { id }, data: { label } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}

export const PATCH = withApiLogging(patchHandler, 'api/sessions/[id]');
