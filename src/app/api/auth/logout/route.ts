import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, getCurrentSid, revokeSession } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { isHttpsRequest } from '@/lib/request-utils';

function clearedCookieResponse(request: NextRequest, body: object, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: isHttpsRequest(request, process.env.TRUST_FORWARDED_PROTO === 'true'),
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const sid = await getCurrentSid();
  if (sid) {
    try {
      await revokeSession(sid);
    } catch (err) {
      // Clear the cookie regardless so the client appears logged out, but
      // surface the failure so the operator can investigate (DB down, etc.).
      console.error('[Auth] Failed to revoke session on logout:', err);
      return clearedCookieResponse(request, { error: 'Failed to revoke session on logout' }, 500);
    }
  }

  return clearedCookieResponse(request, { success: true }, 200);
}

export const POST = withApiLogging(postHandler, 'api/auth/logout');
