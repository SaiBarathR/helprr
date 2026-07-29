import { NextResponse } from 'next/server';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { LOCAL_PASSWORD_MAX_BYTES } from '@/lib/password-policy';
import {
  LOCAL_USERNAME_MAX_CODE_POINTS,
  localUsernameValidationError,
  normalizeLocalUsername,
} from '@/lib/username-policy';

export const LOGIN_BODY_MAX_BYTES = 8 * 1024;
export const LOGIN_USERNAME_MAX_CODE_POINTS = LOCAL_USERNAME_MAX_CODE_POINTS;
export const LOGIN_PASSWORD_MAX_BYTES = LOCAL_PASSWORD_MAX_BYTES;

export interface LoginCredentials {
  username: string;
  password: string;
}

type LoginInputResult =
  | { ok: true; credentials: LoginCredentials }
  | { ok: false; response: NextResponse; malformed: true };

function malformed(message: string): LoginInputResult {
  return {
    ok: false,
    response: NextResponse.json({ error: message }, { status: 400 }),
    malformed: true,
  };
}

export async function readLoginCredentials(request: Request): Promise<LoginInputResult> {
  let body: unknown;
  try {
    body = await readBoundedJson<unknown>(request, LOGIN_BODY_MAX_BYTES);
  } catch (error) {
    const response = boundedBodyErrorResponse(error);
    if (response) return { ok: false, response, malformed: true };
    throw error;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return malformed('Invalid request body');
  }

  const usernameValue = (body as { username?: unknown }).username;
  const password = (body as { password?: unknown }).password;
  if (typeof usernameValue !== 'string') {
    return malformed('Username is required');
  }
  const usernameError = localUsernameValidationError(usernameValue);
  if (usernameError) return malformed(usernameError);
  const username = normalizeLocalUsername(usernameValue);
  if (typeof password !== 'string' || password.length === 0) {
    return malformed('Password is required');
  }
  if (Buffer.byteLength(password, 'utf8') > LOGIN_PASSWORD_MAX_BYTES) {
    return malformed(`Password must be at most ${LOGIN_PASSWORD_MAX_BYTES} bytes`);
  }

  return { ok: true, credentials: { username, password } };
}
