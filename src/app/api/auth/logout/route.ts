import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

function isHttpsRequest(request: NextRequest): boolean {
  if (request.nextUrl.protocol === 'https:') return true;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
  }
  return false;
}

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
