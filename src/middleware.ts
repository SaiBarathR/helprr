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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow service worker and manifest
  if (pathname === '/sw.js' || pathname === '/sw-push.js' || pathname === '/manifest.json' || pathname.startsWith('/_next')) {
    return NextResponse.next();
  }

  // Allow static assets
  if (pathname.startsWith('/icons') || pathname.startsWith('/images')) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    await jwtVerify(token, getJwtSecret());
    return NextResponse.next();
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
