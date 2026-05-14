import type { NextRequest } from 'next/server';

export function isHttpsRequest(request: NextRequest, trustProxy = false): boolean {
  if (request.nextUrl.protocol === 'https:') return true;
  if (!trustProxy) return false;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
  }
  return false;
}
