import type { NextRequest, NextResponse } from 'next/server';
import { isHttpsRequest } from '@/lib/request-utils';

// Set when someone signs out, so the login page does not sign them straight
// back in through the sign-in proxy (trusted-header sign-in). It is not a
// secret and grants nothing: it only stops the login page's automatic attempt,
// and a tap on Sign in still tries. Any successful sign-in clears it.
export const SIGNED_OUT_COOKIE = 'helprr-signed-out';
const SIGNED_OUT_MAX_AGE_SECONDS = 24 * 60 * 60;

function setCookie(response: NextResponse, request: NextRequest, value: string, maxAge: number): void {
  response.cookies.set(SIGNED_OUT_COOKIE, value, {
    httpOnly: true,
    secure: isHttpsRequest(request, process.env.TRUST_FORWARDED_PROTO === 'true'),
    sameSite: 'lax',
    maxAge,
    path: '/',
  });
}

export function setSignedOutMarker(response: NextResponse, request: NextRequest): void {
  setCookie(response, request, '1', SIGNED_OUT_MAX_AGE_SECONDS);
}

/** On a sign-in response: drop the marker if this browser has one. */
export function clearSignedOutMarker(response: NextResponse, request: NextRequest): void {
  if (request.cookies.has(SIGNED_OUT_COOKIE)) setCookie(response, request, '', 0);
}

export function hasSignedOutMarker(request: NextRequest): boolean {
  return request.cookies.has(SIGNED_OUT_COOKIE);
}
