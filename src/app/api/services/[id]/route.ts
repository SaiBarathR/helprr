import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { ensureDefaultForType, setDefaultConnection } from '@/lib/arr-instances';
import { maskApiKey } from '@/lib/service-connection-secrets';

async function deleteHandler(_request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('settings.instances');
  if (capError) return capError;

  const { id } = await ctx.params;
  const existing = await prisma.serviceConnection.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.serviceConnection.delete({ where: { id } }); // PollingState cascades
  await ensureDefaultForType(existing.type); // promote a sibling if we removed the default
  return NextResponse.json({ ok: true });
}

async function patchHandler(request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('settings.instances');
  if (capError) return capError;

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

  const updated = await prisma.serviceConnection.findUnique({ where: { id } });
  return NextResponse.json({ ...updated, apiKey: updated ? maskApiKey(updated.apiKey) : null });
}

export const DELETE = withApiLogging(deleteHandler, 'api/services/[id]');
export const PATCH = withApiLogging(patchHandler, 'api/services/[id]');
