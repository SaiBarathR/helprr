import { NextRequest, NextResponse } from 'next/server';
import { ServiceType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { isServiceType } from '@/lib/service-connection-secrets';
import { withApiLogging } from '@/lib/api-logger';

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

  const type = body.type;
  if (typeof type !== 'string' || !isServiceType(type)) {
    return NextResponse.json({ error: 'Invalid service type' }, { status: 400 });
  }
  const serviceType = ServiceType[type];

  const rawUrl = body.externalUrl;
  const externalUrl = typeof rawUrl === 'string' && rawUrl.trim()
    ? rawUrl.trim().replace(/\/+$/, '')
    : null;

  try {
    const existing = await prisma.serviceConnection.findUnique({ where: { type: serviceType } });
    if (!existing) {
      return NextResponse.json({ error: 'Service not configured' }, { status: 404 });
    }

    const updated = await prisma.serviceConnection.update({
      where: { type: serviceType },
      data: { externalUrl },
    });

    return NextResponse.json({ type: updated.type, externalUrl: updated.externalUrl });
  } catch (error) {
    console.error('Failed to update external URL:', error);
    return NextResponse.json({ error: 'Failed to update external URL' }, { status: 500 });
  }
}

export const PUT = withApiLogging(putHandler, 'api/services/external-url');
