import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getJwtSecret } from '@/lib/jwt-secret';

const COOKIE_NAME = 'helprr-session';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/jellyfin'];
const IS_DEV = process.env.NODE_ENV === 'development';

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control': 'off',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': IS_DEV
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https: http:; media-src 'self' blob: data: http: https:; font-src 'self' https:; connect-src 'self' ws: wss: http: https:; frame-src 'self' https://www.youtube.com https://www.dailymotion.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    // media-src: direct Jellyfin streaming (broad https: mirrors img/connect —
    // middleware runs on edge and can't read the JF origin from the DB); blob:
    // is required by hls.js MSE. http-only Jellyfin under https Helprr cannot
    // stream (mixed content) by design.
    : "default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; media-src 'self' blob: https:; font-src 'self' https:; connect-src 'self' wss: https:; frame-src 'self' https://www.youtube.com https://www.dailymotion.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};

function addSecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * Redirects an unauthenticated page request to /login, preserving the original
 * path + query as a `next` param so deep links (e.g. /protocol?u=...) survive
 * the login round-trip. The login page validates and honors `next`.
 */
function redirectToLogin(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const loginUrl = new URL('/login', request.url);
  const target = `${pathname}${search}`;
  if (pathname !== '/' && pathname !== '/login') {
    loginUrl.searchParams.set('next', target);
  }
  return addSecurityHeaders(NextResponse.redirect(loginUrl));
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

  // Web Share Target POSTs hit /api/share directly from the OS share sheet.
  // Let the request through so the route handler can run its own requireAuth
  // check and, when unauthenticated, 303-redirect through /login while
  // preserving the shared payload (middleware can't read the multipart body to
  // forward it, and a JSON 401 here would land the user on a raw error page).
  if (pathname === '/api/share') {
    return addSecurityHeaders(NextResponse.next());
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }
    return redirectToLogin(request);
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] });
    if (typeof payload.sid !== 'string' || !payload.sid) {
      if (pathname.startsWith('/api/')) {
        return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
      }
      return redirectToLogin(request);
    }
    return addSecurityHeaders(NextResponse.next());
  } catch {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }
    return redirectToLogin(request);
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
