import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { DATE_FORMATS, TIME_FORMATS, parseDateFormat, parseTimeFormat } from '@/lib/date-format';
import { WATCHING_EPISODE_DAYS_DEFAULT, WATCHING_EPISODE_DAY_OPTIONS } from '@/lib/notification-events';
import { isValidTimeZone } from '@/lib/timezone';
import { getOrCreateAppSettings } from '@/lib/app-settings';

// Genuinely-personal settings for the current user: the push quiet-hours window,
// the "New episode" window, the date/time display format and their own time
// zone (null: the server's); the global AppSettings (admin) are served
// separately by /api/settings.
const SELECT = {
  quietHoursEnabled: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  timeFormat: true,
  dateFormat: true,
  watchingEpisodeDays: true,
  timeZone: true,
} as const;

/** Longest IANA name is about 30 characters; anything far past it is not one. */
const TIME_ZONE_MAX_LENGTH = 64;

type SavedSettings = {
  quietHoursEnabled: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timeFormat: string | null;
  dateFormat: string | null;
  watchingEpisodeDays: number;
  timeZone: string | null;
} | null;

// Stored null means 'auto' (follow the browser locale). New episode alerts need
// the person's own Jellyfin link, so the page can say when it is missing.
// serverTimeZone is what "Same as the server" means now.
async function toResponse(settings: SavedSettings, jellyfinUserId: string | null) {
  return {
    quietHoursEnabled: settings?.quietHoursEnabled ?? false,
    quietHoursStart: settings?.quietHoursStart ?? null,
    quietHoursEnd: settings?.quietHoursEnd ?? null,
    timeFormat: parseTimeFormat(settings?.timeFormat),
    dateFormat: parseDateFormat(settings?.dateFormat),
    watchingEpisodeDays: settings?.watchingEpisodeDays ?? WATCHING_EPISODE_DAYS_DEFAULT,
    jellyfinLinked: Boolean(jellyfinUserId),
    timeZone: settings?.timeZone ?? null,
    serverTimeZone: (await getOrCreateAppSettings()).timeZone,
  };
}

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const settings = await prisma.userSettings.findUnique({
    where: { userId: auth.user.id },
    select: SELECT,
  });

  return NextResponse.json(await toResponse(settings, auth.user.jellyfinUserId));
}

function parseHour(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23) return value;
  return undefined; // invalid
}

async function patchHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const data: {
    quietHoursEnabled?: boolean;
    quietHoursStart?: number | null;
    quietHoursEnd?: number | null;
    timeFormat?: string | null;
    dateFormat?: string | null;
    watchingEpisodeDays?: number;
    timeZone?: string | null;
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

  if ('timeFormat' in body) {
    if (typeof body.timeFormat !== 'string' || !(TIME_FORMATS as readonly string[]).includes(body.timeFormat)) {
      return NextResponse.json({ error: `timeFormat must be one of ${TIME_FORMATS.join(', ')}` }, { status: 400 });
    }
    data.timeFormat = body.timeFormat === 'auto' ? null : body.timeFormat;
  }
  if ('dateFormat' in body) {
    if (typeof body.dateFormat !== 'string' || !(DATE_FORMATS as readonly string[]).includes(body.dateFormat)) {
      return NextResponse.json({ error: `dateFormat must be one of ${DATE_FORMATS.join(', ')}` }, { status: 400 });
    }
    data.dateFormat = body.dateFormat === 'auto' ? null : body.dateFormat;
  }

  if ('watchingEpisodeDays' in body) {
    if (!(WATCHING_EPISODE_DAY_OPTIONS as readonly unknown[]).includes(body.watchingEpisodeDays)) {
      return NextResponse.json({ error: `watchingEpisodeDays must be one of ${WATCHING_EPISODE_DAY_OPTIONS.join(', ')}` }, { status: 400 });
    }
    data.watchingEpisodeDays = body.watchingEpisodeDays as number;
  }

  // null: "Same as the server". Otherwise an IANA name this server's Intl knows.
  if ('timeZone' in body) {
    if (body.timeZone === null) {
      data.timeZone = null;
    } else if (
      typeof body.timeZone !== 'string'
      || body.timeZone.length > TIME_ZONE_MAX_LENGTH
      // A bare offset ("+05:30") is not a zone: it never follows daylight saving.
      || /^[+-]/.test(body.timeZone)
      || !isValidTimeZone(body.timeZone)
    ) {
      return NextResponse.json({ error: 'timeZone must be a time zone name (like Europe/London) or null' }, { status: 400 });
    } else {
      data.timeZone = body.timeZone;
    }
  }

  const saved = await prisma.userSettings.upsert({
    where: { userId: auth.user.id },
    update: data,
    create: { userId: auth.user.id, ...data },
    select: SELECT,
  });

  return NextResponse.json(await toResponse(saved, auth.user.jellyfinUserId));
}

export const GET = withApiLogging(getHandler, 'api/me/settings');
export const PATCH = withApiLogging(patchHandler, 'api/me/settings');
