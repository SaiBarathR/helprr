import { NextRequest, NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { COOKIE_NAME, SESSION_DURATION, createSession } from '@/lib/auth';
import { clearUsernameBackoff, getClientIp } from '@/lib/login-rate-limit';
import { hashPassword } from '@/lib/password';
import { isWellFormedPasswordLinkToken, redeemPasswordLink } from '@/lib/password-links';
import { localPasswordValidationError } from '@/lib/password-policy';
import { isHttpsRequest } from '@/lib/request-utils';
import { recordSecurityEvent } from '@/lib/security-audit';
import { invalidLinkResponse, readInviteRequest } from '@/lib/server/invite-request';

/**
 * Public: use an invite or password-reset link. Sets the chosen password, makes
 * the account active, ends the link, revokes every session of the user, and
 * signs this browser in.
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const input = await readInviteRequest(request);
  if (!input.ok) return input.response;
  const { token, password } = input.body;

  // Checked before the password is hashed, so junk tokens cost no scrypt work.
  if (!isWellFormedPasswordLinkToken(token)) return invalidLinkResponse();
  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }
  const passwordError = localPasswordValidationError(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  const user = await redeemPasswordLink(token, await hashPassword(password));
  if (!user) return invalidLinkResponse();
  // A forgotten password may have left the account in sign-in backoff.
  await clearUsernameBackoff(user.username);
  await recordSecurityEvent(request, {
    actor: { id: user.id, username: user.username },
    action: user.purpose === 'invite' ? 'INVITE_ACCEPTED' : 'RESET_LINK_USED',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.username,
    fields: user.purpose === 'invite' ? ['password', 'status'] : ['password'],
    // Sessions the reset revoked; an invited account has none.
    ...(user.purpose === 'reset' ? { count: user.revokedSessions } : {}),
  });

  const sessionToken = await createSession({
    userId: user.id,
    role: user.role,
    userAgent: request.headers.get('user-agent'),
    ip: getClientIp(request),
  });
  const response = NextResponse.json({ success: true });
  // The same flags as a normal sign-in (src/app/api/auth/login/route.ts).
  response.cookies.set(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: isHttpsRequest(request, process.env.TRUST_FORWARDED_PROTO === 'true'),
    sameSite: 'lax',
    maxAge: SESSION_DURATION,
    path: '/',
  });
  return response;
}

export const POST = withApiLogging(postHandler, 'api/invite/accept', { logBodies: false });
