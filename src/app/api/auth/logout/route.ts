import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}

export const POST = withApiLogging(postHandler, 'api/auth/logout');
