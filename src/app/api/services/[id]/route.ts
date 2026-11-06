import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { clearConnectionMemo, ensureDefaultForType, setDefaultConnection } from '@/lib/arr-instances';
import { serializeConnection } from '@/lib/service-connection-secrets';
import { changedFieldNames, recordSecurityEvent, serviceTargetLabel } from '@/lib/security-audit';

async function deleteHandler(request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const existing = await prisma.serviceConnection.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.serviceConnection.delete({ where: { id } }); // PollingState cascades
  await recordSecurityEvent(request, {
    actor: auth.user,
    action: 'SERVICE_DELETED',
    targetType: 'service',
    targetId: id,
    targetLabel: serviceTargetLabel(existing.type, existing.label),
  });
  await ensureDefaultForType(existing.type); // promote a sibling if we removed the default
  clearConnectionMemo();
  await invalidateTaggedLibrary(existing.type.toLowerCase(), id);
  return NextResponse.json({ ok: true });
}

async function patchHandler(request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const existing = await prisma.serviceConnection.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.isDefault === true) {
    await setDefaultConnection(id);
  }
  if (typeof body.label === 'string' && body.label.trim()) {
    try {
      await prisma.serviceConnection.update({ where: { id }, data: { label: body.label.trim() } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return NextResponse.json({ error: 'That name is already in use for this service' }, { status: 409 });
      }
      throw err;
    }
  }

  clearConnectionMemo();
  const updated = await prisma.serviceConnection.findUnique({ where: { id } });
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await invalidateTaggedLibrary(updated.type.toLowerCase(), id);
  const fields = changedFieldNames(existing, updated, ['label', 'isDefault']);
  if (fields.length > 0) {
    await recordSecurityEvent(request, {
      actor: auth.user,
      action: 'SERVICE_UPDATED',
      targetType: 'service',
      targetId: id,
      targetLabel: serviceTargetLabel(updated.type, updated.label),
      fields,
    });
  }
  return NextResponse.json(serializeConnection(updated));
}

export const DELETE = withApiLogging(deleteHandler, 'api/services/[id]');
export const PATCH = withApiLogging(patchHandler, 'api/services/[id]');
