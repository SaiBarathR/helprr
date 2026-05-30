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
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N < 2 || r < 1 || p < 1) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

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
