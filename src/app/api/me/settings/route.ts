import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

// Genuinely-personal settings for the current user. Today this is just the
// per-user push quiet-hours window; the global AppSettings (admin) are served
// separately by /api/settings.
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const settings = await prisma.userSettings.findUnique({
    where: { userId: auth.user.id },
    select: { quietHoursEnabled: true, quietHoursStart: true, quietHoursEnd: true },
  });

  return NextResponse.json({
    quietHoursEnabled: settings?.quietHoursEnabled ?? false,
    quietHoursStart: settings?.quietHoursStart ?? null,
    quietHoursEnd: settings?.quietHoursEnd ?? null,
  });
}

function parseHour(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23) return value;
  return undefined; // invalid
}

async function patchHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const data: {
    quietHoursEnabled?: boolean;
    quietHoursStart?: number | null;
    quietHoursEnd?: number | null;
  } = {};

  if ('quietHoursEnabled' in body) {
    if (typeof body.quietHoursEnabled !== 'boolean') {
      return NextResponse.json({ error: 'quietHoursEnabled must be a boolean' }, { status: 400 });
    }
    data.quietHoursEnabled = body.quietHoursEnabled;
  }
  if ('quietHoursStart' in body) {
    const h = parseHour(body.quietHoursStart);
    if (h === undefined) return NextResponse.json({ error: 'quietHoursStart must be 0-23 or null' }, { status: 400 });
    data.quietHoursStart = h;
  }
  if ('quietHoursEnd' in body) {
    const h = parseHour(body.quietHoursEnd);
    if (h === undefined) return NextResponse.json({ error: 'quietHoursEnd must be 0-23 or null' }, { status: 400 });
    data.quietHoursEnd = h;
  }

  const saved = await prisma.userSettings.upsert({
    where: { userId: auth.user.id },
    update: data,
    create: { userId: auth.user.id, ...data },
    select: { quietHoursEnabled: true, quietHoursStart: true, quietHoursEnd: true },
  });

  return NextResponse.json(saved);
}

export const GET = withApiLogging(getHandler, 'api/me/settings');
export const PATCH = withApiLogging(patchHandler, 'api/me/settings');
