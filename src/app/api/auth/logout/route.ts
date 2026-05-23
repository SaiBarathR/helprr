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
      // Don't clear the cookie if revoke failed — otherwise the client looks
      // logged out while the server-side session is still valid, so anything
      // that knows the cookie value (other tabs, lifted backups) keeps full
      // access. Surfacing the 500 lets the user retry once the DB recovers.
      console.error('[Auth] Failed to revoke session on logout:', err);
      return NextResponse.json(
        { error: 'Failed to revoke session on logout' },
        { status: 500 }
      );
    }
  }

  return clearedCookieResponse(request, { success: true }, 200);
}

export const POST = withApiLogging(postHandler, 'api/auth/logout');
