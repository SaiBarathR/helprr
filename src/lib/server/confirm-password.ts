import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { randomUUID } from 'crypto';
import { verifyUserPassword } from '@/lib/auth';
import { LOCAL_PASSWORD_MAX_BYTES } from '@/lib/password-policy';
import {
  getClientIp,
  enforceLoginRateLimit,
  enforceUsernameBackoff,
  recordUsernameFailure,
  clearUsernameBackoff,
  enforceGlobalLoginBackstop,
  recordGlobalLoginFailure,
} from '@/lib/login-rate-limit';
import { recordFailedSignIn, recordSecurityEvent } from '@/lib/security-audit';
import {
  clearMfaAttempts,
  consumeSecondFactor,
  isTotpEnabled,
  mfaLockedResponse,
  secondFactorKind,
  startMfaAttempt,
  type SecondFactor,
} from '@/lib/totp';

/**
 * Check the signed-in user's current password behind the same throttles as
 * sign-in, counting a wrong one as a failed sign-in (as a password change
 * does). Null when it is right. The caller clears the username backoff once
 * everything it asks for has passed.
 */
export async function confirmCurrentPassword(
  request: NextRequest,
  user: Pick<User, 'id' | 'username' | 'passwordHash'>,
  currentPassword: unknown,
): Promise<NextResponse | null> {
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return NextResponse.json({ error: 'Current password is required' }, { status: 400 });
  }
  if (Buffer.byteLength(currentPassword, 'utf8') > LOCAL_PASSWORD_MAX_BYTES) {
    return NextResponse.json({ error: `Password must be at most ${LOCAL_PASSWORD_MAX_BYTES} bytes` }, { status: 400 });
  }

  const limited = await enforceLoginRateLimit(getClientIp(request));
  if (limited) return limited;
  const backoff = await enforceUsernameBackoff(user.username);
  if (backoff) return backoff;
  const globalBackstop = await enforceGlobalLoginBackstop();
  if (globalBackstop) return globalBackstop;

  if (!(await verifyUserPassword(user, currentPassword))) {
    await recordUsernameFailure(user.username, currentPassword);
    await recordGlobalLoginFailure();
    await recordFailedSignIn(request, { username: user.username, method: 'password', user, actor: user });
    // 403, not 401: the client sends every 401 to /login, and the session is fine.
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });
  }
  return null;
}

/**
 * The current password, then a code from the authenticator app or a recovery
 * code, for an action a signed-in session alone must not take while two-step
 * sign-in is on (turning it off, a reset link for your own account). Behind
 * the sign-in throttles and the account's hourly code cap; a wrong code counts
 * as a failed sign-in, and a right one is used up. Fails closed (503) when
 * Redis is down. The caller checks the code's shape first.
 */
export async function confirmPasswordAndSecondFactor(
  request: NextRequest,
  user: Pick<User, 'id' | 'username' | 'passwordHash' | 'totpSecret' | 'totpEnabledAt' | 'totpLastUsedStep'>,
  currentPassword: unknown,
  code: string,
): Promise<{ ok: true; factor: SecondFactor } | { ok: false; response: NextResponse }> {
  const passwordError = await confirmCurrentPassword(request, user, currentPassword);
  if (passwordError) return { ok: false, response: passwordError };

  let gate: Awaited<ReturnType<typeof startMfaAttempt>>;
  try {
    gate = await startMfaAttempt(user.id, secondFactorKind(code));
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Login service unavailable' }, { status: 503 }) };
  }
  if (!gate.ok) return { ok: false, response: mfaLockedResponse(gate.reason === 'locked' ? gate.retryMs : 60_000) };

  const factor = await consumeSecondFactor(user, code);
  if (!factor) {
    await recordUsernameFailure(user.username, randomUUID());
    await recordGlobalLoginFailure();
    await recordFailedSignIn(request, { username: user.username, method: 'totp', user, actor: user });
    return { ok: false, response: NextResponse.json({ error: 'That code didn’t work. Try again.', field: 'code' }, { status: 403 }) };
  }
  await clearMfaAttempts(user.id);
  await clearUsernameBackoff(user.username);
  return { ok: true, factor };
}

type StepUpUser = Pick<User, 'id' | 'username' | 'passwordHash' | 'totpSecret' | 'totpEnabledAt' | 'totpLastUsedStep'>;

/**
 * The acting admin's current password, plus a code (or a recovery code) when
 * their own two-step sign-in is on, for a step that hands out admin: creating
 * an admin, making someone admin, or a way into another admin's account. A
 * signed-in session alone must not be able to take one. The same checks,
 * throttles, code cap and failed sign-in records as turning two-step sign-in
 * off. Null when confirmed. Missing factors are a 403 with `needsStepUp` (and
 * `needsCode`), so the page can ask for them; an admin with no Helprr password
 * (Jellyfin-only) is refused, closed. `step` names the action in the audit
 * row of a used recovery code. Also guards other steps a session alone must
 * not take (importing user accounts, changing the Jellyfin connection,
 * turning an admin back on); `action` starts the message that asks for them.
 */
export async function confirmAdminStepUp(
  request: NextRequest,
  admin: StepUpUser,
  body: unknown,
  step: string,
  action = 'Giving admin access',
): Promise<NextResponse | null> {
  const needsCode = isTotpEnabled(admin);
  if (!admin.passwordHash) {
    return NextResponse.json(
      { error: 'This needs your Helprr password, and your account has none. Set one in Settings → Account first.' },
      { status: 403 },
    );
  }
  const { currentPassword, code } = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as {
    currentPassword?: unknown;
    code?: unknown;
  };
  const missingPassword = typeof currentPassword !== 'string' || currentPassword.length === 0;
  const missingCode = needsCode && (typeof code !== 'string' || code.trim().length === 0 || code.length > 64);
  if (missingPassword || missingCode) {
    return NextResponse.json(
      {
        error: needsCode
          ? `${action} needs your current password and a code from your authenticator app (or a recovery code).`
          : `${action} needs your current password.`,
        needsStepUp: true,
        needsCode,
      },
      { status: 403 },
    );
  }

  if (needsCode) {
    const confirmed = await confirmPasswordAndSecondFactor(request, admin, currentPassword, code as string);
    if (!confirmed.ok) return confirmed.response;
    if (confirmed.factor === 'recovery-code') {
      await recordSecurityEvent(request, {
        actor: admin,
        action: 'MFA_RECOVERY_CODE_USED',
        targetType: 'user',
        targetId: admin.id,
        targetLabel: admin.username,
        fields: [step],
      });
    }
    return null;
  }
  const passwordError = await confirmCurrentPassword(request, admin, currentPassword);
  if (passwordError) return passwordError;
  await clearUsernameBackoff(admin.username);
  return null;
}
