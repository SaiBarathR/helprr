import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import {
  clearUsernameBackoff,
  recordGlobalLoginFailure,
  recordUsernameFailure,
} from '@/lib/login-rate-limit';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { confirmCurrentPassword } from '@/lib/server/confirm-password';
import { withApiLogging } from '@/lib/api-logger';
import { recordFailedSignIn, recordSecurityEvent } from '@/lib/security-audit';
import { randomUUID } from 'crypto';
import { clearMfaAttempts, consumeSecondFactor, isTotpEnabled, mfaLockedResponse, startMfaAttempt } from '@/lib/totp';

const BODY_MAX_BYTES = 8 * 1024;

/** Whether two-step sign-in is on for the signed-in user, and how many recovery codes are left. */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const enabled = isTotpEnabled(user);
  const recoveryCodesLeft = enabled ? await prisma.recoveryCode.count({ where: { userId: user.id } }) : 0;
  return NextResponse.json(
    { available: user.passwordHash !== null, enabled, recoveryCodesLeft },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Turn two-step sign-in off. Needs the current password and a code (or a
 * recovery code), so a signed-in session alone cannot remove it. Both are
 * checked behind the sign-in throttles and a wrong one counts as a failed
 * sign-in.
 */
async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body: unknown;
  try {
    body = await readBoundedJson<unknown>(request, BODY_MAX_BYTES);
  } catch (error) {
    const response = boundedBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { currentPassword, code } = body as { currentPassword?: unknown; code?: unknown };
  if (typeof code !== 'string' || code.trim().length === 0 || code.length > 64) {
    return NextResponse.json({ error: 'Enter a code from your authenticator app or a recovery code' }, { status: 400 });
  }
  if (!isTotpEnabled(user)) {
    return NextResponse.json({ error: 'Two-step sign-in is already off' }, { status: 409 });
  }

  const passwordError = await confirmCurrentPassword(request, user, currentPassword);
  if (passwordError) return passwordError;

  let gate: Awaited<ReturnType<typeof startMfaAttempt>>;
  try {
    gate = await startMfaAttempt(user.id);
  } catch {
    return NextResponse.json({ error: 'Login service unavailable' }, { status: 503 });
  }
  if (!gate.ok) return mfaLockedResponse(gate.reason === 'locked' ? gate.retryMs : 60_000);

  const factor = await consumeSecondFactor(user, code);
  if (!factor) {
    await recordUsernameFailure(user.username, randomUUID());
    await recordGlobalLoginFailure();
    await recordFailedSignIn(request, { username: user.username, method: 'totp', user, actor: user });
    return NextResponse.json({ error: 'That code didn’t work. Try again.', field: 'code' }, { status: 403 });
  }
  await clearMfaAttempts(user.id);
  await clearUsernameBackoff(user.username);

  await prisma.$transaction([
    prisma.user.updateMany({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabledAt: null, totpLastUsedStep: null },
    }),
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
  ]);

  if (factor === 'recovery-code') {
    await recordSecurityEvent(request, {
      actor: user,
      action: 'MFA_RECOVERY_CODE_USED',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.username,
      fields: ['turn-off'],
    });
  }
  await recordSecurityEvent(request, {
    actor: user,
    action: 'MFA_DISABLED',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.username,
    fields: ['totp'],
  });

  return NextResponse.json({ ok: true });
}

export const GET = withApiLogging(getHandler, 'api/me/totp');
export const DELETE = withApiLogging(deleteHandler, 'api/me/totp', { logBodies: false });
