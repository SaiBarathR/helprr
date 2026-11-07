import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import {
  can,
  parsePermissions,
  effectiveCapabilities,
  deltaFromTemplate,
  type CapabilityMap,
} from '@/lib/permissions';
import { CAPABILITIES, isCapability } from '@/lib/capabilities';
import { withApiLogging } from '@/lib/api-logger';
import { recordSecurityEvent } from '@/lib/security-audit';
import { confirmAdminStepUp } from '@/lib/server/confirm-password';

const TEMPLATES = new Set(['admin', 'member']);

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    template: user.template,
    overrides: parsePermissions(user.permissions),
    effective: effectiveCapabilities(user),
  });
}

async function putHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: { template?: string; permissions?: object } = {};

  // Applying a template (or an explicit reset) clears all per-cap overrides.
  const templateProvided = typeof body.template === 'string';
  if (templateProvided) {
    if (!TEMPLATES.has(body.template as string)) {
      return NextResponse.json({ error: 'Invalid template' }, { status: 400 });
    }
    data.template = body.template as string;
  }
  const resetToTemplate = body.resetToTemplate === true;

  if (templateProvided || resetToTemplate) {
    data.permissions = {};
  } else if (body.permissions && typeof body.permissions === 'object') {
    // Validate to known caps + booleans, then store only the deltas vs template.
    const desired: CapabilityMap = {};
    for (const [k, v] of Object.entries(body.permissions as Record<string, unknown>)) {
      if (typeof v === 'boolean' && isCapability(k)) desired[k] = v;
    }
    data.permissions = deltaFromTemplate(user.template, desired);
  } else {
    return NextResponse.json(
      { error: 'Provide `permissions`, `template`, or `resetToTemplate: true`' },
      { status: 400 }
    );
  }

  // The Admin template gives a member every capability (settings.instances
  // and backups among them), so it asks for the acting admin's password (and
  // code), as making them admin does: applying it, and reaching every
  // capability another way (re-applying it over turned-off ones, or turning
  // the last ones on).
  const everyCapability = (target: Parameters<typeof effectiveCapabilities>[0]) => {
    const caps = effectiveCapabilities(target);
    return CAPABILITIES.every((cap) => caps[cap] === true);
  };
  const givingAdminTemplate = user.role !== 'admin' && (
    (data.template === 'admin' && user.template !== 'admin')
    || (!everyCapability(user) && everyCapability({ ...user, ...data }))
  );
  if (givingAdminTemplate) {
    const stepUp = await confirmAdminStepUp(
      request,
      admin.user,
      body,
      'admin-template',
      data.template === 'admin' ? 'Giving the Admin template' : 'Giving every capability',
    );
    if (stepUp) return stepUp;
  }

  // Losing calendar.view also ends the calendar feed link, so giving the
  // capability back later does not bring an old link back.
  // A write applies only to the role and template it read, as whether it
  // needed the step-up above depends on them. (Overrides are written whole, so
  // the result is always the set the check above saw.)
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id, role: user.role, template: user.template },
      data,
    });
    const feedRevoked = !can(updated, 'calendar.view')
      && (await tx.calendarFeedToken.deleteMany({ where: { userId: id } })).count > 0;
    return { updated, feedRevoked };
  }).catch((error: unknown) => {
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2025') return null;
    throw error;
  });
  if (!result) {
    return NextResponse.json({ error: 'This user changed while saving. Reload and try again.' }, { status: 409 });
  }
  const { updated, feedRevoked } = result;
  // The capabilities whose effective value changed, by name.
  const before = effectiveCapabilities(user);
  const after = effectiveCapabilities(updated);
  const fields = [
    ...(updated.template !== user.template ? ['template'] : []),
    ...Object.keys(after).filter((cap) => after[cap as keyof typeof after] !== before[cap as keyof typeof before]),
  ];
  if (fields.length > 0) {
    await recordSecurityEvent(request, {
      actor: admin.user,
      action: 'USER_PERMISSIONS_CHANGED',
      targetType: 'user',
      targetId: id,
      targetLabel: updated.username,
      fields,
    });
  }
  if (feedRevoked) {
    await recordSecurityEvent(request, {
      actor: admin.user,
      action: 'CALENDAR_FEED_REVOKED',
      targetType: 'user',
      targetId: id,
      targetLabel: updated.username,
      fields: ['calendar.view'],
    });
  }
  return NextResponse.json({
    template: updated.template,
    overrides: parsePermissions(updated.permissions),
    effective: effectiveCapabilities(updated),
  });
}

export const GET = withApiLogging(getHandler, 'api/users/[id]/permissions');
// The body can hold the acting admin's password and code.
export const PUT = withApiLogging(putHandler, 'api/users/[id]/permissions', { logBodies: false });
