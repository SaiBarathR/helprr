import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

let jwtSecretBytes: Uint8Array | null = null;

function getJwtSecret(): Uint8Array {
  if (jwtSecretBytes) return jwtSecretBytes;

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET env var is required');
  }

  jwtSecretBytes = new TextEncoder().encode(jwtSecret);
  return jwtSecretBytes;
}

const COOKIE_NAME = 'helprr-session';

const PUBLIC_PATHS = ['/login', '/api/auth/login'];
const IS_DEV = process.env.NODE_ENV !== 'production';

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control': 'off',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': IS_DEV
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https: http:; font-src 'self' https:; connect-src 'self' ws: wss: http: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    : "default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' wss: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};

function addSecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return addSecurityHeaders(NextResponse.next());
  }

  // Allow service worker and manifest
  if (pathname === '/sw.js' || pathname === '/sw-push.js' || pathname === '/manifest.json' || pathname.startsWith('/_next')) {
    return addSecurityHeaders(NextResponse.next());
  }

  // Allow static assets
  if (pathname.startsWith('/icons') || pathname.startsWith('/images')) {
    return addSecurityHeaders(NextResponse.next());
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }
    return addSecurityHeaders(NextResponse.redirect(new URL('/login', request.url)));
  }

  try {
    await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] });
    return addSecurityHeaders(NextResponse.next());
  } catch {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }
    return addSecurityHeaders(NextResponse.redirect(new URL('/login', request.url)));
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
