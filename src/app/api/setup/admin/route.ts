import { NextRequest, NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { COOKIE_NAME, SESSION_DURATION, createSession } from '@/lib/auth';
import {
  FirstAdminInputError,
  FirstAdminTakenError,
  claimFirstAdmin,
  isSameOriginRequest,
  needsFirstAdmin,
} from '@/lib/first-admin';
import { enforceGlobalLoginBackstop, enforceLoginRateLimit, getClientIp } from '@/lib/login-rate-limit';
import { isHttpsRequest } from '@/lib/request-utils';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { LOGIN_BODY_MAX_BYTES } from '@/lib/server/login-input';

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

/**
 * Creates the first admin and signs them in. Public only while there is no user
 * and no APP_PASSWORD; after that it is gone for good.
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  if (!(await needsFirstAdmin())) return NOT_FOUND();
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Create the admin from Helprr itself' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Expected JSON' }, { status: 415 });
  }

  const limited = await enforceLoginRateLimit(getClientIp(request));
  if (limited) return limited;
  const backstop = await enforceGlobalLoginBackstop();
  if (backstop) return backstop;

  let body: unknown;
  try {
    body = await readBoundedJson<unknown>(request, LOGIN_BODY_MAX_BYTES);
  } catch (error) {
    const response = boundedBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  let admin: { id: string; role: 'admin' };
  try {
    const { username, password } = body as { username?: unknown; password?: unknown };
    admin = await claimFirstAdmin({ username, password });
  } catch (error) {
    if (error instanceof FirstAdminInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof FirstAdminTakenError) {
      return NextResponse.json({ error: 'An admin already exists. Sign in instead.' }, { status: 409 });
    }
    throw error;
  }

  const token = await createSession({
    userId: admin.id,
    role: admin.role,
    userAgent: request.headers.get('user-agent'),
    ip: getClientIp(request),
  });
  const response = NextResponse.json({ success: true });
  // The same flags as a normal sign-in (src/app/api/auth/login/route.ts).
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttpsRequest(request, process.env.TRUST_FORWARDED_PROTO === 'true'),
    sameSite: 'lax',
    maxAge: SESSION_DURATION,
    path: '/',
  });
  return response;
}

export const POST = withApiLogging(postHandler, 'api/setup/admin', { logBodies: false });
