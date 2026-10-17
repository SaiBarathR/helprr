import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { BOOTSTRAP_ADMIN_ID } from '@/lib/bootstrap-admin';
import { withApiLogging } from '@/lib/api-logger';
import { MAX_IMPORT_BYTES } from '@/lib/settings-export';
import { validateSettingsImportComplexity } from '@/lib/settings-import-validation';
import { runImportFollowUps, type ImportWarning } from '@/lib/settings-import/follow-ups';
import { applySettingsImport, type ImportApplied, type ImportOutcome } from '@/lib/settings-import/run-import';
import type { ImportRequestBody } from '@/lib/settings-import/shared';

interface ImportResult {
  applied: ImportApplied;
  skipped: string[];
  /** Saved, but not yet in effect on this server; each can be retried. */
  warnings: ImportWarning[];
  discoverLayoutApplied: boolean;
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.backup');
  if (!auth.ok) return auth.response;

  // Imported watchlist items are attributed to the importing admin (the export
  // format is owner-agnostic). Falls back to the bootstrap admin defensively.
  const importerId = auth.user.id ?? BOOTSTRAP_ADMIN_ID;

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_IMPORT_BYTES} bytes)` },
      { status: 413 }
    );
  }

  // content-length can be spoofed or absent; enforce on the actual read body too.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  // `raw.length` counts UTF-16 code units, not bytes — a multi-byte emoji
  // counts as 1–2 there but 4 bytes on the wire. Compare bytes against the
  // byte cap.
  if (Buffer.byteLength(raw, 'utf8') > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_IMPORT_BYTES} bytes)` },
      { status: 413 }
    );
  }

  let body: ImportRequestBody;
  try {
    body = JSON.parse(raw) as ImportRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const complexityError = validateSettingsImportComplexity(body);
  if (complexityError) {
    return NextResponse.json({ error: complexityError }, { status: 400 });
  }

  // Mirror of the export-side rule: a non-admin with settings.backup may only
  // restore their own watchlist and scheduled alerts (uiPrefs never reach this
  // route). Every other section writes global state — service connections,
  // user accounts, app settings, cleanup rules, layouts, notification devices.
  if (auth.user.role !== 'admin') {
    const globalSections = [
      body.appSettings,
      body.serviceConnections,
      body.notificationDevice,
      body.cleanup,
      body.discoverLayout,
      body.dashboardLayouts,
      body.animeMappings,
      body.users,
    ];
    if (globalSections.some((section) => section != null)) {
      return NextResponse.json(
        { error: 'Only admins can import global settings, service connections, or user accounts' },
        { status: 403 }
      );
    }
  }

  let outcome: ImportOutcome;
  try {
    outcome = await applySettingsImport(body, importerId);
  } catch (error) {
    console.error('Failed to import settings', error);
    return NextResponse.json(
      { error: 'Failed to import settings' },
      { status: 500 }
    );
  }

  // Everything is committed. Bring this server in line with it; a step that
  // fails comes back as a warning the operator can retry
  // (POST /api/settings/import/follow-up) instead of failing a saved import.
  const warnings = await runImportFollowUps(outcome.followUps);

  const result: ImportResult = {
    applied: outcome.applied,
    skipped: outcome.skipped,
    warnings,
    discoverLayoutApplied: outcome.discoverLayoutApplied,
  };
  return NextResponse.json(result);
}

export const POST = withApiLogging(postHandler, 'api/settings/import', { logBodies: false });
