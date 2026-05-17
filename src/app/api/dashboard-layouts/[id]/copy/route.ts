import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { copyLayout, ServiceError } from '@/lib/dashboard-layouts';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function postHandler(_request: NextRequest, context: RouteContext) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await context.params;
  try {
    const row = await copyLayout(id);
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to copy dashboard layout:', error);
    return NextResponse.json({ error: 'Failed to copy dashboard layout' }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/dashboard-layouts/[id]/copy');
