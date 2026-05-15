import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import {
  reconcileDiscoverLayout,
  validateDiscoverLayout,
  DEFAULT_DISCOVER_LAYOUT,
  type DiscoverLayoutConfig,
} from '@/lib/discover-layout-config';

async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { discoverLayout: true },
    });

    const raw = settings?.discoverLayout as unknown;
    const layout = reconcileDiscoverLayout(
      raw ? validateDiscoverLayout(raw) : null
    );

    return NextResponse.json(layout);
  } catch (error) {
    console.error('Failed to fetch discover layout:', error);
    return NextResponse.json(
      { error: 'Failed to fetch discover layout' },
      { status: 500 }
    );
  }
}

async function putHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const validated = validateDiscoverLayout(body);

    if (!validated) {
      return NextResponse.json(
        { error: 'Invalid discover layout configuration' },
        { status: 400 }
      );
    }

    const reconciled = reconcileDiscoverLayout(validated);

    await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: { discoverLayout: reconciled as unknown as Prisma.InputJsonValue },
      create: {
        id: 'singleton',
        discoverLayout: reconciled as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json(reconciled);
  } catch (error) {
    console.error('Failed to save discover layout:', error);
    return NextResponse.json(
      { error: 'Failed to save discover layout' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/settings/discover-layout');
export const PUT = withApiLogging(putHandler, 'api/settings/discover-layout');
