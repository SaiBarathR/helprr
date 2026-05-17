import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { createLayout, listLayouts, seedInitialLayouts, ServiceError } from '@/lib/dashboard-layouts';

async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    await seedInitialLayouts();
    const data = await listLayouts();
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
  const authError = await requireAuth();
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { name, widgets } = (body ?? {}) as { name?: unknown; widgets?: unknown };

  try {
    const row = await createLayout({ name, widgets });
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
