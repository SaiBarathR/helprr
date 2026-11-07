import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { clearConnectionMemo } from '@/lib/arr-instances';
import { recordSecurityEvent, serviceTargetLabel } from '@/lib/security-audit';

async function putHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

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
    // Jellyfin's builds the "Open in Jellyfin" links everyone follows, so only
    // an admin sets or clears it. Unchanged, nothing is written, so a member's
    // save cannot put back an older value.
    if (existing.type === 'JELLYFIN' && auth.user.role !== 'admin') {
      if (existing.externalUrl !== externalUrl) {
        return NextResponse.json({ error: 'Only an admin can set Jellyfin\'s external URL.' }, { status: 403 });
      }
      return NextResponse.json({ id: existing.id, type: existing.type, externalUrl: existing.externalUrl });
    }
    const updated = await prisma.serviceConnection.update({
      where: { id: id.trim() },
      data: { externalUrl },
    });
    clearConnectionMemo();
    if (existing.externalUrl !== updated.externalUrl) {
      await recordSecurityEvent(request, {
        actor: auth.user,
        action: 'SERVICE_UPDATED',
        targetType: 'service',
        targetId: updated.id,
        targetLabel: serviceTargetLabel(updated.type, updated.label),
        fields: ['externalUrl'],
      });
    }
    return NextResponse.json({ id: updated.id, type: updated.type, externalUrl: updated.externalUrl });
  } catch (error) {
    console.error('Failed to update external URL:', error);
    return NextResponse.json({ error: 'Failed to update external URL' }, { status: 500 });
  }
}

export const PUT = withApiLogging(putHandler, 'api/services/external-url');
