import type { NextRequest } from 'next/server';

export function isHttpsRequest(request: NextRequest): boolean {
  if (request.nextUrl.protocol === 'https:') return true;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
  }
  return false;
}
