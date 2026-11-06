import { NextResponse, type NextRequest } from 'next/server';
import {
  enforceInviteFailureBackstop,
  enforceInviteRateLimit,
  recordInviteFailure,
} from '@/lib/invite-rate-limit';
import { getClientIp } from '@/lib/login-rate-limit';
import { recordFailedLinkAttempt } from '@/lib/security-audit';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { LOGIN_BODY_MAX_BYTES } from '@/lib/server/login-input';

/** One answer for every link that cannot be used, so a probe learns nothing about which links exist. */
export const INVALID_LINK_MESSAGE = 'This link is invalid or has expired. Ask your admin for a new one.';

type InviteRequest = { ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse };

/**
 * The public /api/invite routes have their own throttles (invite-rate-limit.ts),
 * apart from sign-in's, so junk links cannot lock anyone out of signing in:
 * the failed-attempt backstop first, then the per-IP bucket (with a trusted
 * proxy) before the body is read, so junk bodies are limited per client too.
 * Junk bodies and unusable links count as failures. The trade-off, as with
 * sign-in's global backstop: a caller who keeps failing can hold the invite
 * page at 429, but never sign-in. JSON only, so a cross-site form cannot post here.
 */
export async function readInviteRequest(request: NextRequest): Promise<InviteRequest> {
  const backstop = await enforceInviteFailureBackstop();
  if (backstop) return { ok: false, response: backstop };
  const limited = await enforceInviteRateLimit(getClientIp(request));
  if (limited) return { ok: false, response: limited };

  let body: unknown;
  try {
    body = await readBoundedJson<unknown>(request, LOGIN_BODY_MAX_BYTES);
  } catch (error) {
    const response = boundedBodyErrorResponse(error);
    if (!response) throw error;
    await recordInviteFailure();
    return { ok: false, response };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    await recordInviteFailure();
    return { ok: false, response: NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) };
  }

  return { ok: true, body: body as Record<string, unknown> };
}

/** The generic answer for an unusable link; counted and audited (never the token). */
export async function invalidLinkResponse(request: NextRequest): Promise<NextResponse> {
  await Promise.all([recordInviteFailure(), recordFailedLinkAttempt(request)]);
  return NextResponse.json({ error: INVALID_LINK_MESSAGE }, { status: 404 });
}
