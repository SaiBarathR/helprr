import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import {
  MANUAL_SETUP_STEPS,
  dismissSetupChecklist,
  getSetupChecklist,
  isSetupStep,
  markSetupStepDone,
  restoreSetupChecklist,
} from '@/lib/setup-checklist';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

// Admin only: the dashboard's setup checklist. Members never see it.
async function getHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return NextResponse.json(await getSetupChecklist(admin.user.id), { headers: NO_STORE });
}

// { action: 'dismiss' } hides it on every device ({ action: 'restore' } undoes that);
// { action: 'done', step } marks a step the server cannot see (people, install, backup).
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = (await request.json().catch(() => null)) as { action?: unknown; step?: unknown } | null;
  if (body?.action === 'dismiss') {
    await dismissSetupChecklist(admin.user.id);
  } else if (body?.action === 'restore') {
    await restoreSetupChecklist(admin.user.id);
  } else if (body?.action === 'done' && isSetupStep(body.step) && MANUAL_SETUP_STEPS.has(body.step)) {
    await markSetupStepDone(admin.user.id, body.step);
  } else {
    return NextResponse.json({ error: 'Unknown checklist action' }, { status: 400 });
  }
  return NextResponse.json(await getSetupChecklist(admin.user.id), { headers: NO_STORE });
}

export const GET = withApiLogging(getHandler, 'api/setup-checklist');
export const POST = withApiLogging(postHandler, 'api/setup-checklist');
