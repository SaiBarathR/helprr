import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { recordSecurityEvent } from '@/lib/security-audit';
import { confirmAdminStepUp } from '@/lib/server/confirm-password';

/**
 * Turn off another user's two-step sign-in, for someone who lost their phone
 * and their recovery codes. In one transaction it clears the secret and the
 * recovery codes and ends every session of the user, so they sign in again
 * with their password alone. Not for your own account: there it takes your
 * password and a code (Settings -> Account), so a signed-in session alone
 * cannot remove it. (A reset link you make for yourself also turns it off; making
 * one needs the same password and code, see ../password-link.) For another
 * admin it takes the acting admin's password, and a code while their own
 * two-step sign-in is on: it is a way into that admin's account.
 */
async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  if (id === admin.user.id) {
    return NextResponse.json(
      { error: 'Turn off your own two-step sign-in in Settings → Account' },
      { status: 409 }
    );
  }
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, role: true, totpEnabledAt: true } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Before the step-up, so a code is not used up on nothing.
  if (!user.totpEnabledAt) return NextResponse.json({ error: 'Two-step sign-in is already off' }, { status: 409 });

  if (user.role === 'admin') {
    const body: unknown = await request.json().catch(() => null);
    const stepUp = await confirmAdminStepUp(
      request,
      admin.user,
      body,
      'admin-two-step-off',
      'Turning off another admin’s two-step sign-in',
    );
    if (stepUp) return stepUp;
  }

  const result = await prisma.$transaction(async (tx) => {
    // User row first, as the other account changes lock it. Only while it is on,
    // so two admins at once write one audit row between them. Only for the role
    // read, as whether it needed the step-up above depends on it.
    const updated = await tx.user.updateMany({
      where: { id, role: user.role, totpEnabledAt: { not: null } },
      data: { totpSecret: null, totpEnabledAt: null, totpLastUsedStep: null },
    });
    if (updated.count === 0) {
      const now = await tx.user.findUnique({ where: { id }, select: { role: true } });
      return now && now.role !== user.role ? ('changed' as const) : null;
    }
    await tx.recoveryCode.deleteMany({ where: { userId: id } });
    const revoked = await tx.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revokedSessions: revoked.count };
  });
  if (result === 'changed') {
    return NextResponse.json({ error: 'This user changed while saving. Reload and try again.' }, { status: 409 });
  }
  if (!result) {
    return NextResponse.json({ error: 'Two-step sign-in is already off' }, { status: 409 });
  }

  await recordSecurityEvent(request, {
    actor: admin.user,
    action: 'MFA_DISABLED',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.username,
    fields: ['admin'],
    // Sessions of the user signed out with it.
    count: result.revokedSessions,
  });
  return NextResponse.json({ ok: true, revokedSessions: result.revokedSessions });
}

// The body can hold the acting admin's password and code.
export const DELETE = withApiLogging(deleteHandler, 'api/users/[id]/totp', { logBodies: false });
