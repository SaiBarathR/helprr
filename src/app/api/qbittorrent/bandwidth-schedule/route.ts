import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { parseBandwidthSchedule } from '@/lib/bandwidth-scheduler/parse';
import { pickActiveRule } from '@/lib/bandwidth-scheduler/active-rule';

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const settings = await getOrCreateAppSettings();
  const schedule = parseBandwidthSchedule(settings.qbtBandwidthSchedule);
  const active = pickActiveRule(schedule.rules, new Date(), settings.timeZone);
  return NextResponse.json({
    schedule,
    timeZone: settings.timeZone,
    activeRuleId: active?.id ?? null,
  });
}

async function putHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('torrents.bandwidth');
  if (capError) return capError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Run the input through the same tolerant parser the runtime uses, then
  // verify the result preserved every input rule — otherwise the user's draft
  // had an invalid field and we want a hard error rather than silently
  // dropping a rule.
  const incoming = (body && typeof body === 'object' && Array.isArray((body as { rules?: unknown }).rules))
    ? (body as { rules: unknown[] })
    : null;
  if (!incoming) {
    return NextResponse.json(
      { error: 'Expected { rules: [...] }' },
      { status: 400 }
    );
  }
  const parsed = parseBandwidthSchedule(incoming);
  if (parsed.rules.length !== incoming.rules.length) {
    return NextResponse.json(
      { error: 'One or more rules failed validation' },
      { status: 400 }
    );
  }

  // The count check above catches dropped rules, but parseRule also silently
  // normalizes two fields while keeping the rule: it dedupes/sorts daysOfWeek
  // and trims/truncates/defaults the name. Reject those so a save never
  // persists values the user didn't actually enter. Rules align positionally
  // here because the count matched (parse preserves order when nothing drops).
  for (let i = 0; i < parsed.rules.length; i++) {
    const raw = incoming.rules[i] as Record<string, unknown>;
    const rule = parsed.rules[i];
    if (raw.name !== rule.name) {
      return NextResponse.json(
        { error: `Rule name must be trimmed, non-empty, and at most 80 characters` },
        { status: 400 }
      );
    }
    const rawDays = raw.daysOfWeek;
    if (
      !Array.isArray(rawDays) ||
      rawDays.length !== rule.daysOfWeek.length ||
      rule.daysOfWeek.some((d, j) => d !== rawDays[j])
    ) {
      return NextResponse.json(
        { error: 'Days of week must be unique and sorted ascending' },
        { status: 400 }
      );
    }
  }

  const persisted = parsed as unknown as Prisma.InputJsonValue;
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: { qbtBandwidthSchedule: persisted },
    create: { id: 'singleton', qbtBandwidthSchedule: persisted },
  });

  const settings = await getOrCreateAppSettings();
  const active = pickActiveRule(parsed.rules, new Date(), settings.timeZone);
  return NextResponse.json({
    schedule: parsed,
    timeZone: settings.timeZone,
    activeRuleId: active?.id ?? null,
  });
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/bandwidth-schedule');
export const PUT = withApiLogging(putHandler, 'api/qbittorrent/bandwidth-schedule');
