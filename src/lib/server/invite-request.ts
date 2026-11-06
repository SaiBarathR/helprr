import { NextResponse, type NextRequest } from 'next/server';
import {
  enforceGlobalLoginBackstop,
  enforceLoginRateLimit,
  enforceMalformedLoginBackstop,
  getClientIp,
  recordGlobalLoginFailure,
  recordMalformedLoginRequest,
} from '@/lib/login-rate-limit';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { LOGIN_BODY_MAX_BYTES } from '@/lib/server/login-input';

/** One answer for every link that cannot be used, so a probe learns nothing about which links exist. */
export const INVALID_LINK_MESSAGE = 'This link is invalid or has expired. Ask your admin for a new one.';

type InviteRequest = { ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse };

/**
 * The public /api/invite routes sit behind the same throttles as sign-in: junk
 * bodies count toward the malformed backstop, every request toward the per-IP
 * bucket (with a trusted proxy), and every unusable link toward the global
 * failed-attempt backstop. JSON only, so a cross-site form cannot post here.
 */
export async function readInviteRequest(request: NextRequest): Promise<InviteRequest> {
  const malformedBackstop = await enforceMalformedLoginBackstop();
  if (malformedBackstop) return { ok: false, response: malformedBackstop };

  let body: unknown;
  try {
    body = await readBoundedJson<unknown>(request, LOGIN_BODY_MAX_BYTES);
  } catch (error) {
    const response = boundedBodyErrorResponse(error);
    if (!response) throw error;
    return { ok: false, response: (await recordMalformedLoginRequest()) ?? response };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const response = NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    return { ok: false, response: (await recordMalformedLoginRequest()) ?? response };
  }

  const limited = await enforceLoginRateLimit(getClientIp(request));
  if (limited) return { ok: false, response: limited };
  const backstop = await enforceGlobalLoginBackstop();
  if (backstop) return { ok: false, response: backstop };

  return { ok: true, body: body as Record<string, unknown> };
}

export async function invalidLinkResponse(): Promise<NextResponse> {
  await recordGlobalLoginFailure();
  return NextResponse.json({ error: INVALID_LINK_MESSAGE }, { status: 404 });
}
