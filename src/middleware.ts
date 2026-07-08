import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getJwtSecret } from '@/lib/jwt-secret';

const COOKIE_NAME = 'helprr-session';

// Prefix-matched public routes (login page + auth endpoints).
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/jellyfin'];
// Exact-matched public routes: /api/health is the container liveness probe —
// matched exactly so a future /api/health-* route isn't silently exposed.
const PUBLIC_EXACT_PATHS = ['/api/health'];
const IS_DEV = process.env.NODE_ENV === 'development';

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control': 'off',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// Dev keeps a relaxed policy: Fast Refresh needs eval, and dev-injected inline
// scripts carry no nonce.
const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https: http:; font-src 'self' https:; connect-src 'self' ws: wss: http: https:; frame-src 'self' https://www.youtube.com https://www.dailymotion.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

// Production script-src is nonce-based. Modern browsers honor
// 'nonce-…' + 'strict-dynamic' and ignore the host sources and
// 'unsafe-inline'; older browsers ignore the nonce and fall back to
// 'self' https: 'unsafe-inline' (the pre-nonce policy). Styles keep
// 'unsafe-inline' — Next.js and the component library inject inline styles.
//
// worker-src is set explicitly: without it, the service worker load falls back
// through child-src to script-src, where 'strict-dynamic' makes the browser
// ignore 'self' and reject the same-origin sw.js registration (a worker load
// isn't part of the strict-dynamic trust-propagation chain). The PWA service
// worker — push + offline — is core, so pin it to its own 'self' directive.
function buildProdCsp(nonce: string): string {
  return `default-src 'self'; script-src 'self' 'unsafe-inline' https: 'nonce-${nonce}' 'strict-dynamic'; worker-src 'self'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' wss: https:; frame-src 'self' https://www.youtube.com https://www.dailymotion.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
}

function addSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

/**
 * Redirects an unauthenticated page request to /login, preserving the original
 * path + query as a `next` param so deep links (e.g. /protocol?u=...) survive
 * the login round-trip. The login page validates and honors `next`.
 */
function redirectToLogin(request: NextRequest, csp: string): NextResponse {
  const { pathname, search } = request.nextUrl;
  const loginUrl = new URL('/login', request.url);
  const target = `${pathname}${search}`;
  if (pathname !== '/' && pathname !== '/login') {
    loginUrl.searchParams.set('next', target);
  }
  return addSecurityHeaders(NextResponse.redirect(loginUrl), csp);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Per-request CSP. In production the nonce + policy also ride on the request
  // headers: Next.js reads the content-security-policy request header and
  // stamps the nonce onto its own inline scripts, and the root layout reads
  // x-nonce for the theme bootstrap script.
  let csp = DEV_CSP;
  let requestHeaders: Headers | undefined;
  if (!IS_DEV) {
    const nonce = btoa(crypto.randomUUID());
    csp = buildProdCsp(nonce);
    requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', csp);
  }
  const pass = () =>
    addSecurityHeaders(
      requestHeaders ? NextResponse.next({ request: { headers: requestHeaders } }) : NextResponse.next(),
      csp
    );

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p)) || PUBLIC_EXACT_PATHS.includes(pathname)) {
    return pass();
  }

  // Allow service worker and manifest
  if (pathname === '/sw.js' || pathname === '/sw-push.js' || pathname === '/manifest.json' || pathname.startsWith('/_next')) {
    return pass();
  }

  // Allow static assets
  if (pathname.startsWith('/icons') || pathname.startsWith('/images')) {
    return pass();
  }

  // Web Share Target POSTs hit /api/share directly from the OS share sheet.
  // Let the request through so the route handler can run its own requireAuth
  // check and, when unauthenticated, 303-redirect through /login while
  // preserving the shared payload (middleware can't read the multipart body to
  // forward it, and a JSON 401 here would land the user on a raw error page).
  if (pathname === '/api/share') {
    return pass();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), csp);
    }
    return redirectToLogin(request, csp);
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] });
    if (typeof payload.sid !== 'string' || !payload.sid) {
      if (pathname.startsWith('/api/')) {
        return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), csp);
      }
      return redirectToLogin(request, csp);
    }
    return pass();
  } catch {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), csp);
    }
    return redirectToLogin(request, csp);
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
