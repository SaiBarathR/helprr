import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { timingSafeEqual } from 'crypto';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET env var is required');
}
const JWT_SECRET = new TextEncoder().encode(jwtSecret);

const SESSION_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds
const COOKIE_NAME = 'helprr-session';

export async function createSession(): Promise<string> {
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(JWT_SECRET);

  return token;
}

export async function verifySession(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return verifySession(token);
}

export function verifyPassword(password: string): boolean {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) return false;
  const passwordBuffer = Buffer.from(password);
  const appPasswordBuffer = Buffer.from(appPassword);
  if (passwordBuffer.length !== appPasswordBuffer.length) return false;
  return timingSafeEqual(passwordBuffer, appPasswordBuffer);
}

export { COOKIE_NAME, SESSION_DURATION };
