import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { clearUsernameBackoff } from '@/lib/login-rate-limit';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { confirmCurrentPassword } from '@/lib/server/confirm-password';
import { withApiLogging } from '@/lib/api-logger';
import { createTotpSetup, isTotpEnabled } from '@/lib/totp';

const BODY_MAX_BYTES = 8 * 1024;

/**
 * Start turning on two-step sign-in: after the current password, store a new
 * authenticator secret and return it once, as a key and an otpauth URI for a
 * QR code. Nothing changes at sign-in until /api/me/totp/enable confirms a code
 * from it. Starting again replaces a secret that was never confirmed.
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!user.passwordHash) {
    return NextResponse.json(
      { error: 'Two-step sign-in is for accounts with a Helprr password' },
      { status: 409 },
    );
  }
  if (isTotpEnabled(user)) {
    return NextResponse.json({ error: 'Two-step sign-in is already on' }, { status: 409 });
  }

  const passwordError = await confirmCurrentPassword(request, user, (body as { currentPassword?: unknown }).currentPassword);
  if (passwordError) return passwordError;
  await clearUsernameBackoff(user.username);

  const setup = createTotpSetup(user.username);
  const updated = await prisma.user.updateMany({
    where: { id: user.id, status: 'active', totpEnabledAt: null },
    data: { totpSecret: setup.encryptedSecret, totpLastUsedStep: null },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: 'Your account changed. Reload and try again.' }, { status: 409 });
  }

  return NextResponse.json(
    { secret: setup.secret, uri: setup.uri },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export const POST = withApiLogging(postHandler, 'api/me/totp/setup', { logBodies: false });
