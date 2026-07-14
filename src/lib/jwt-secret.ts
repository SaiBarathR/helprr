import { getValidatedJwtSecret } from '@/lib/runtime-config';

let jwtSecretBytes: Uint8Array | null = null;

export function getJwtSecret(): Uint8Array {
  if (jwtSecretBytes) return jwtSecretBytes;

  // HS256 keys shorter than the 256-bit hash output are weak, and the shipped
  // example is long enough to pass a length-only check. Reuse startup's
  // placeholder-safe validation here because middleware may load separately.
  const jwtSecret = getValidatedJwtSecret(process.env.JWT_SECRET);

  jwtSecretBytes = new TextEncoder().encode(jwtSecret);
  return jwtSecretBytes;
}
