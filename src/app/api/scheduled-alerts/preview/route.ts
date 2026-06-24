import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { prisma } from '@/lib/db';
import { getDefaultTimeZone, isAlertScope, normalizeDraft, parseReleaseTypes } from '@/lib/scheduled-alerts/helpers';
import { previewScheduledAlert } from '@/lib/scheduled-alerts/resolver';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('scheduledAlerts.view');
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const draft = normalizeDraft((body.draft as Record<string, unknown>) ?? body);
  if (!draft) return NextResponse.json({ error: 'Invalid media draft' }, { status: 400 });

  const settings = await getOrCreateAppSettings();
  const userSettings = await prisma.userSettings.findUnique({ where: { userId: auth.user.id } });
  const timeZone = getDefaultTimeZone(
    typeof body.timeZone === 'string' ? body.timeZone : userSettings?.timeZone ?? settings.timeZone,
  );

  const scopeRaw = typeof body.scope === 'string' ? body.scope : undefined;
  if (scopeRaw !== undefined && !isAlertScope(scopeRaw)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  }

  const offsetRaw =
    typeof body.offsetMinutes === 'number' && Number.isFinite(body.offsetMinutes)
      ? Math.max(0, Math.min(10_080, Math.round(body.offsetMinutes)))
      : undefined;

  const preview = await previewScheduledAlert(draft, {
    scheduleMode:
      body.scheduleMode === 'absolute' || body.scheduleMode === 'release_relative'
        ? body.scheduleMode
        : undefined,
    scope: scopeRaw,
    releaseTypes: parseReleaseTypes(body.releaseTypes),
    offsetMinutes: offsetRaw,
    timeZone,
    seasonNumber: draft.seasonNumber,
    episodeId: draft.episodeId,
  });

  return NextResponse.json({
    ...preview,
    candidates: preview.candidates.map((c) => ({
      ...c,
      releaseAt: c.releaseAt?.toISOString() ?? null,
      notifyAt: c.notifyAt.toISOString(),
    })),
  });
}

export const POST = withApiLogging(postHandler, 'api/scheduled-alerts/preview');
