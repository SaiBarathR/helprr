import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { withApiLogging } from '@/lib/api-logger';
import { recordSecurityEvent } from '@/lib/security-audit';
import {
  clearMfaAttempts,
  generateRecoveryCodes,
  isTotpEnabled,
  matchTotpStep,
  mfaLockedResponse,
  startMfaAttempt,
} from '@/lib/totp';

const BODY_MAX_BYTES = 8 * 1024;

class AccountChangedError extends Error {}

/**
 * Finish turning on two-step sign-in: a code from the authenticator proves it
 * holds the secret from /api/me/totp/setup. Makes ten recovery codes and
 * returns them once; only their hashes are kept. Tries count toward the same
 * hourly cap as codes at sign-in, so a session alone cannot guess its way in.
 * With signOutOtherDevices: true, every other session of the user ends in the
 * same transaction; this one stays. A reset link the user made for themselves
 * (an admin) ends too: made without the password and a code, it must not
 * later turn off the two-step sign-in being turned on here.
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, session } = auth;

  let body: unknown;
  try {
    body = await readBoundedJson<unknown>(request, BODY_MAX_BYTES);
  } catch (error) {
    const response = boundedBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const { code, signOutOtherDevices } = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as {
    code?: unknown;
    signOutOtherDevices?: unknown;
  };
  if (typeof code !== 'string' || code.length > 64) {
    return NextResponse.json({ error: 'Enter the code from your authenticator app' }, { status: 400 });
  }
  if (signOutOtherDevices !== undefined && typeof signOutOtherDevices !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (isTotpEnabled(user)) {
    return NextResponse.json({ error: 'Two-step sign-in is already on' }, { status: 409 });
  }
  if (!user.passwordHash || !user.totpSecret) {
    return NextResponse.json({ error: 'Start the setup again' }, { status: 409 });
  }

  let gate: Awaited<ReturnType<typeof startMfaAttempt>>;
  try {
    gate = await startMfaAttempt(user.id, 'totp');
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
  if (!gate.ok) return mfaLockedResponse(gate.reason === 'locked' ? gate.retryMs : 60_000);

  const step = matchTotpStep(user.totpSecret, code);
  if (step === null) {
    return NextResponse.json({ error: 'That code didn’t work. Check the time on your phone and try again.' }, { status: 400 });
  }

  const recovery = generateRecoveryCodes();
  let revokedSessions = 0;
  let endedOwnResetLink = false;
  try {
    revokedSessions = await prisma.$transaction(async (tx) => {
      // Only the secret this code was checked against, and only if setup was not finished meanwhile.
      const updated = await tx.user.updateMany({
        where: { id: user.id, status: 'active', totpEnabledAt: null, totpSecret: user.totpSecret },
        data: { totpEnabledAt: new Date(), totpLastUsedStep: step },
      });
      if (updated.count === 0) throw new AccountChangedError();
      // After the row update, which holds the row the self reset link route locks.
      const ended = await tx.passwordLink.deleteMany({ where: { userId: user.id, purpose: 'reset', createdById: user.id } });
      endedOwnResetLink = ended.count > 0;
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.recoveryCode.createMany({
        data: recovery.hashes.map((codeHash) => ({ userId: user.id, codeHash })),
      });
      if (signOutOtherDevices !== true) return 0;
      const revoked = await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null, NOT: { id: session.id } },
        data: { revokedAt: new Date() },
      });
      return revoked.count;
    });
  } catch (error) {
    if (error instanceof AccountChangedError) {
      return NextResponse.json({ error: 'Your account changed. Reload and try again.' }, { status: 409 });
    }
    throw error;
  }

  await clearMfaAttempts(user.id);
  await recordSecurityEvent(request, {
    actor: user,
    action: 'MFA_ENABLED',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.username,
    fields: ['totp'],
  });
  if (endedOwnResetLink) {
    await recordSecurityEvent(request, {
      actor: user,
      action: 'RESET_LINK_REVOKED',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.username,
      fields: ['totp'],
    });
  }
  if (revokedSessions > 0) {
    await recordSecurityEvent(request, {
      actor: user,
      action: 'SESSION_REVOKED',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.username,
      count: revokedSessions,
    });
  }

  return NextResponse.json(
    { recoveryCodes: recovery.codes },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export const POST = withApiLogging(postHandler, 'api/me/totp/enable', { logBodies: false });
