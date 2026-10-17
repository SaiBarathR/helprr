import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { MAX_IMPORT_ARRAY_ENTRIES } from '@/lib/settings-import-validation';
import {
  ALL_SERVICE_TYPES,
  IMPORT_FOLLOW_UPS,
  isImportFollowUp,
  runImportFollowUps,
} from '@/lib/settings-import/follow-ups';

// An import cannot hold more alerts than this, so a retry can always carry
// every alert one import left unresolved.
const MAX_ALERT_IDS = MAX_IMPORT_ARRAY_ENTRIES;

// Re-runs the runtime steps a settings import reported as not done, from what
// the database holds now. No imported data is sent again; every step is safe to
// repeat.
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.backup');
  if (!auth.ok) return auth.response;

  let body: { tasks?: unknown; alertIds?: unknown } | null;
  try {
    body = (await request.json()) as { tasks?: unknown; alertIds?: unknown } | null;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const tasks = body?.tasks;
  if (
    !Array.isArray(tasks)
    || tasks.length === 0
    || tasks.length > IMPORT_FOLLOW_UPS.length
    || !tasks.every(isImportFollowUp)
  ) {
    return NextResponse.json({ error: 'tasks must list the import steps to retry' }, { status: 400 });
  }
  const alertIds = body?.alertIds ?? [];
  if (
    !Array.isArray(alertIds)
    || alertIds.length > MAX_ALERT_IDS
    || !alertIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64)
  ) {
    return NextResponse.json({ error: `alertIds must be up to ${MAX_ALERT_IDS} alert ids` }, { status: 400 });
  }

  // Same boundary as the import: a member restores only their own alerts;
  // every other step changes state shared by everyone.
  const isAdmin = auth.user.role === 'admin';
  if (!isAdmin && tasks.some((task) => task !== 'alertOccurrences')) {
    return NextResponse.json({ error: 'Only admins can retry this' }, { status: 403 });
  }

  const requested = new Set(tasks);
  const warnings = await runImportFollowUps({
    appSettings: requested.has('appSettings'),
    imageCachePurge: requested.has('imageCachePurge'),
    pollingRestart: requested.has('pollingRestart'),
    cleanupStrikePrune: requested.has('cleanupStrikePrune'),
    cleanupSchedulers: requested.has('cleanupSchedulers'),
    alertIds: requested.has('alertOccurrences') ? (alertIds as string[]) : [],
    alertOwnerId: isAdmin ? undefined : auth.user.id,
    dashboardLayoutCache: requested.has('dashboardLayoutCache'),
    serviceTypes: requested.has('defaultInstances') ? ALL_SERVICE_TYPES : [],
  });
  return NextResponse.json({ warnings });
}

export const POST = withApiLogging(postHandler, 'api/settings/import/follow-up');
