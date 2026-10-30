import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { getTwitchSettings } from '@/lib/twitch/settings';

const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

// Whatever this returns is safe for the browser: the browser token is never in it.
async function publicSettings() {
  const { browserAuthToken, ...rest } = await getTwitchSettings();
  return { ...rest, hasBrowserAuthToken: Boolean(browserAuthToken) };
}

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;
  return NextResponse.json(await publicSettings());
}

function intInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

async function putHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const data: Record<string, unknown> = {};
  const bad = (field: string) => NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });

  for (const field of ['autoDownloadEnabled', 'reencodeEnabled'] as const) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'boolean') return bad(field);
    data[field] = body[field];
  }
  const ranges = {
    maxConcurrentDownloads: [1, 6],
    minFreeGb: [1, 10_000],
    reencodeGlobalQuality: [1, 51],
    keepOriginalDays: [0, 365],
  } as const;
  for (const [field, [min, max]] of Object.entries(ranges)) {
    if (body[field] === undefined) continue;
    if (!intInRange(body[field], min, max)) return bad(field);
    data[field] = body[field];
  }
  for (const field of ['reencodeWindowStart', 'reencodeWindowEnd'] as const) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'string' || !HH_MM.test(body[field])) return bad(field);
    data[field] = body[field];
  }

  await getTwitchSettings();
  await prisma.twitchSettings.update({ where: { id: 'singleton' }, data });
  return NextResponse.json(await publicSettings());
}

export const GET = withApiLogging(getHandler, 'api/twitch/settings');
export const PUT = withApiLogging(putHandler, 'api/twitch/settings');
