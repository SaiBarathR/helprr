import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { isHttpsRequest } from '@/lib/request-utils';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: isHttpsRequest(request),
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}

export const POST = withApiLogging(postHandler, 'api/auth/logout');
