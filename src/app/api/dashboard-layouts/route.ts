import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import {
  createLayout,
  listLayouts,
  seedInitialLayouts,
  layoutScopeForUser,
  ServiceError,
} from '@/lib/dashboard-layouts';

async function getHandler() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    await seedInitialLayouts();
    const data = await listLayouts(layoutScopeForUser(auth.user));
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to list dashboard layouts:', error);
    return NextResponse.json({ error: 'Failed to list dashboard layouts' }, { status: 500 });
  }
}

async function postHandler(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  // Members may create their OWN layouts (scoped below); admins create global ones.
  if (!can(auth.user, 'dashboard.customize')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { name, widgets } = (body ?? {}) as { name?: unknown; widgets?: unknown };

  try {
    const row = await createLayout({ name, widgets }, layoutScopeForUser(auth.user));
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to create dashboard layout:', error);
    return NextResponse.json({ error: 'Failed to create dashboard layout' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/dashboard-layouts');
export const POST = withApiLogging(postHandler, 'api/dashboard-layouts');
