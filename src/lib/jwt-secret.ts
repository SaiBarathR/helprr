let jwtSecretBytes: Uint8Array | null = null;

export function getJwtSecret(): Uint8Array {
  if (jwtSecretBytes) return jwtSecretBytes;

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET env var is required');
  }
  // HS256 keys shorter than the 256-bit hash output are trivially weak. Fail
  // fast at boot rather than signing sessions with a guessable secret.
  if (jwtSecret.length < 32) {
    throw new Error(
      `JWT_SECRET must be at least 32 characters (got ${jwtSecret.length}). Generate one with: openssl rand -base64 48`,
    );
  }

  jwtSecretBytes = new TextEncoder().encode(jwtSecret);
  return jwtSecretBytes;
}
