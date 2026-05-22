import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, getCurrentSid, revokeSession } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { isHttpsRequest } from '@/lib/request-utils';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const sid = await getCurrentSid();
  if (sid) {
    try {
      await revokeSession(sid);
    } catch (err) {
      console.error('[Auth] Failed to revoke session on logout:', err);
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: isHttpsRequest(request, process.env.TRUST_FORWARDED_PROTO === 'true'),
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}

export const POST = withApiLogging(postHandler, 'api/auth/logout');
