import { scrypt, randomBytes, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// promisify(scrypt) only types the no-options overload, so wrap the options form
// by hand to keep the cost params (N/r/p/maxmem) type-checked.
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// Password hashing for Helprr's local (username + password) accounts.
//
// scrypt from node:crypto is deliberate: zero new dependencies, no native-addon
// / musl / Docker risk, and it never runs on the Edge (this module is only ever
// imported by Node-runtime route handlers, never by middleware). Cost params are
// encoded into the stored string so a future cost bump re-hashes lazily on the
// next successful login without invalidating existing hashes.

const PREFIX = 'scrypt';
const SCRYPT_N = 16384; // CPU/memory cost factor (2^14) — ~16 MiB working set at r=8
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
// 128 * N * r ≈ 16 MiB for the params above (under Node's 32 MiB default), but we
// raise the ceiling so verifying a hash that was stored with a *higher* N (a
// future cost bump) doesn't trip the memory cap.
const MAXMEM = 128 * 1024 * 1024;
const MAX_STORED_HASH_LENGTH = 1024;
const MIN_IMPORTED_SALT_BYTES = 8;
const MAX_IMPORTED_SALT_BYTES = 64;
const MIN_IMPORTED_KEY_BYTES = 32;
const MAX_IMPORTED_KEY_BYTES = 128;
const MAX_IMPORTED_N = 1_048_576;
const MAX_IMPORTED_R = 32;
const MAX_IMPORTED_P = 16;
const MAX_IMPORTED_WORK_FACTOR = 1_048_576;

interface ParsedPasswordHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  expected: Buffer;
}

function decodeCanonicalBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : null;
}

function parsePasswordHash(stored: string): ParsedPasswordHash | null {
  if (stored.length > MAX_STORED_HASH_LENGTH) return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N < 2 || N > MAX_IMPORTED_N || !Number.isInteger(Math.log2(N))) return null;
  if (r < 1 || r > MAX_IMPORTED_R || p < 1 || p > MAX_IMPORTED_P) return null;
  if (N * r * p > MAX_IMPORTED_WORK_FACTOR) return null;
  if (128 * N * r > MAXMEM / 2) return null;

  const salt = decodeCanonicalBase64(parts[4]);
  const expected = decodeCanonicalBase64(parts[5]);
  if (!salt || salt.length < MIN_IMPORTED_SALT_BYTES || salt.length > MAX_IMPORTED_SALT_BYTES) {
    return null;
  }
  if (!expected || expected.length < MIN_IMPORTED_KEY_BYTES || expected.length > MAX_IMPORTED_KEY_BYTES) {
    return null;
  }
  return { N, r, p, salt, expected };
}

/** Whether a stored value is a bounded, supported Helprr scrypt hash. */
export function isSupportedPasswordHash(stored: string): boolean {
  return parsePasswordHash(stored) !== null;
}

/** Hash a plaintext password into a self-describing `scrypt$N$r$p$salt$hash` string. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scryptAsync(plain, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAXMEM,
  })) as Buffer;
  return [
    PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Verify a plaintext password against a stored `scrypt$...` hash in constant time.
 * Returns false for any malformed/unsupported stored value rather than throwing,
 * so a corrupt row reads as "wrong password" instead of a 500.
 */
export async function verifyPasswordHash(plain: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  const { N, r, p, salt, expected } = parsed;

  let derived: Buffer;
  try {
    derived = (await scryptAsync(plain, salt, expected.length, { N, r, p, maxmem: MAXMEM })) as Buffer;
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// A throwaway hash used to flatten login timing when a username doesn't exist:
// verifying a submitted password against it costs the same scrypt work as
// verifying a real account, so an attacker can't distinguish "no such user"
// from "wrong password" by response latency. Computed once and cached.
let dummyHashPromise: Promise<string> | null = null;

export function getDummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('helprr-timing-flatten-dummy-password');
  }
  return dummyHashPromise;
}
