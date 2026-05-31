import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { setDefaultForDevice, layoutScopeForUser, ServiceError } from '@/lib/dashboard-layouts';

async function putHandler(request: NextRequest) {
  const auth = await requireUserCapability('dashboard.customize');
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { device, layoutId } = (body ?? {}) as { device?: unknown; layoutId?: unknown };

  if (device !== 'desktop' && device !== 'mobile') {
    return NextResponse.json({ error: "device must be 'desktop' or 'mobile'" }, { status: 400 });
  }
  if (typeof layoutId !== 'string' || !layoutId) {
    return NextResponse.json({ error: 'layoutId is required' }, { status: 400 });
  }

  try {
    await setDefaultForDevice(layoutId, device, layoutScopeForUser(auth.user));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to set default dashboard layout:', error);
    return NextResponse.json({ error: 'Failed to set default dashboard layout' }, { status: 500 });
  }
}

export const PUT = withApiLogging(putHandler, 'api/dashboard-layouts/defaults');
