import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { BOOTSTRAP_ADMIN_ID } from '@/lib/bootstrap-admin';
import { withApiLogging } from '@/lib/api-logger';
import { MAX_IMPORT_BYTES } from '@/lib/settings-export';
import { validateSettingsImportComplexity } from '@/lib/settings-import-validation';
import { validateImportSectionLimits } from '@/lib/settings-import/limits';
import { runImportFollowUps, type ImportWarning } from '@/lib/settings-import/follow-ups';
import { applySettingsImport, type ImportApplied, type ImportOutcome } from '@/lib/settings-import/run-import';
import type { ImportRequestBody } from '@/lib/settings-import/shared';
import { recordSecurityEvent, serviceTargetLabel } from '@/lib/security-audit';
import { confirmAdminStepUp } from '@/lib/server/confirm-password';
import { prisma } from '@/lib/db';
import { isNonEmptyString, normalizeServiceUrl } from '@/lib/service-connection-secrets';

/** A Jellyfin entry in the file that adds Jellyfin or gives it another address or key. */
async function changesJellyfin(connections: ImportRequestBody['serviceConnections']): Promise<boolean> {
  const entries = Array.isArray(connections)
    ? connections.filter((c) => c && typeof c === 'object' && c.type === 'JELLYFIN' && typeof c.url === 'string')
    : [];
  if (entries.length === 0) return false;
  const existing = await prisma.serviceConnection.findFirst({ where: { type: 'JELLYFIN' }, select: { url: true, apiKey: true } });
  return entries.some((c) => !existing
    || normalizeServiceUrl(c.url) !== normalizeServiceUrl(existing.url)
    || (isNonEmptyString(c.apiKey) && c.apiKey !== existing.apiKey));
}

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

  const complexityError = validateSettingsImportComplexity(body) ?? validateImportSectionLimits(body);
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
      body.twitch,
      body.youtube,
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

  // User accounts (admins, roles, password hashes, Jellyfin links) and a new
  // Jellyfin address or key (which decides who "Sign in with Jellyfin" signs
  // in) are ways into accounts, so they need the importer's password, and a
  // code while their two-step sign-in is on. Only admins reach here with them.
  const importsUsers = body.users != null;
  if (importsUsers || await changesJellyfin(body.serviceConnections)) {
    const stepUp = await confirmAdminStepUp(
      request,
      auth.user,
      body,
      importsUsers ? 'import-users' : 'import-jellyfin',
      importsUsers ? 'Importing user accounts' : 'Importing the Jellyfin connection',
    );
    if (stepUp) return stepUp;
  }
  delete body.currentPassword;
  delete body.code;

  let outcome: ImportOutcome;
  try {
    outcome = await applySettingsImport(body, importerId, auth.session.id);
  } catch (error) {
    console.error('Failed to import settings', error);
    return NextResponse.json(
      { error: 'Failed to import settings' },
      { status: 500 }
    );
  }

  // The sections that wrote something, by name. Service connections and user
  // accounts are the ones an admin most needs to see were replaced.
  const sections = Object.entries(outcome.applied)
    .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : Boolean(value)))
    .map(([name]) => name);
  if (outcome.discoverLayoutApplied) sections.push('discoverLayout');
  await recordSecurityEvent(request, {
    actor: auth.user,
    action: 'SETTINGS_IMPORTED',
    targetType: 'settings',
    fields: sections,
  });

  if (outcome.jellyfinSignOut && outcome.jellyfinSignOut.sessions > 0) {
    // The new Jellyfin address signed out every Jellyfin-linked account.
    await recordSecurityEvent(request, {
      actor: auth.user,
      action: 'SESSION_REVOKED',
      targetType: 'service',
      targetLabel: serviceTargetLabel('JELLYFIN', ''),
      fields: ['url', `accounts: ${outcome.jellyfinSignOut.accounts}`],
      count: outcome.jellyfinSignOut.sessions,
    });
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
