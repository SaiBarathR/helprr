import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { clearConnectionMemo } from '@/lib/arr-instances';

async function putHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('settings.instances');
  if (capError) return capError;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = body.id;
  if (typeof id !== 'string' || !id.trim()) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const rawUrl = body.externalUrl;
  const externalUrl = typeof rawUrl === 'string' && rawUrl.trim()
    ? rawUrl.trim().replace(/\/+$/, '')
    : null;

  try {
    const existing = await prisma.serviceConnection.findUnique({ where: { id: id.trim() } });
    if (!existing) {
      return NextResponse.json({ error: 'Service not configured' }, { status: 404 });
    }
    const updated = await prisma.serviceConnection.update({
      where: { id: id.trim() },
      data: { externalUrl },
    });
    clearConnectionMemo();
    return NextResponse.json({ id: updated.id, type: updated.type, externalUrl: updated.externalUrl });
  } catch (error) {
    console.error('Failed to update external URL:', error);
    return NextResponse.json({ error: 'Failed to update external URL' }, { status: 500 });
  }
}

export const PUT = withApiLogging(putHandler, 'api/services/external-url');
