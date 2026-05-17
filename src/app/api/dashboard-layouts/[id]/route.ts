import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { deleteLayout, updateLayout, ServiceError } from '@/lib/dashboard-layouts';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function putHandler(request: NextRequest, context: RouteContext) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { name, widgets } = (body ?? {}) as { name?: unknown; widgets?: unknown };

  try {
    const row = await updateLayout(id, { name, widgets });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to update dashboard layout:', error);
    return NextResponse.json({ error: 'Failed to update dashboard layout' }, { status: 500 });
  }
}

async function deleteHandler(_request: NextRequest, context: RouteContext) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await context.params;
  try {
    await deleteLayout(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to delete dashboard layout:', error);
    return NextResponse.json({ error: 'Failed to delete dashboard layout' }, { status: 500 });
  }
}

export const PUT = withApiLogging(putHandler, 'api/dashboard-layouts/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/dashboard-layouts/[id]');
