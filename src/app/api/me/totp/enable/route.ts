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
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
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
  const code = body && typeof body === 'object' && !Array.isArray(body) ? (body as { code?: unknown }).code : undefined;
  if (typeof code !== 'string' || code.length > 64) {
    return NextResponse.json({ error: 'Enter the code from your authenticator app' }, { status: 400 });
  }

  if (isTotpEnabled(user)) {
    return NextResponse.json({ error: 'Two-step sign-in is already on' }, { status: 409 });
  }
  if (!user.passwordHash || !user.totpSecret) {
    return NextResponse.json({ error: 'Start the setup again' }, { status: 409 });
  }

  let gate: Awaited<ReturnType<typeof startMfaAttempt>>;
  try {
    gate = await startMfaAttempt(user.id);
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
  if (!gate.ok) return mfaLockedResponse(gate.reason === 'locked' ? gate.retryMs : 60_000);

  const step = matchTotpStep(user.totpSecret, code);
  if (step === null) {
    return NextResponse.json({ error: 'That code didn’t work. Check the time on your phone and try again.' }, { status: 400 });
  }

  const recovery = generateRecoveryCodes();
  try {
    await prisma.$transaction(async (tx) => {
      // Only the secret this code was checked against, and only if setup was not finished meanwhile.
      const updated = await tx.user.updateMany({
        where: { id: user.id, status: 'active', totpEnabledAt: null, totpSecret: user.totpSecret },
        data: { totpEnabledAt: new Date(), totpLastUsedStep: step },
      });
      if (updated.count === 0) throw new AccountChangedError();
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.recoveryCode.createMany({
        data: recovery.hashes.map((codeHash) => ({ userId: user.id, codeHash })),
      });
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

  return NextResponse.json(
    { recoveryCodes: recovery.codes },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export const POST = withApiLogging(postHandler, 'api/me/totp/enable', { logBodies: false });
