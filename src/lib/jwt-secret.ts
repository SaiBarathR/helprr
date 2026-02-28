let jwtSecretBytes: Uint8Array | null = null;

export function getJwtSecret(): Uint8Array {
  if (jwtSecretBytes) return jwtSecretBytes;

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET env var is required');
  }

  jwtSecretBytes = new TextEncoder().encode(jwtSecret);
  return jwtSecretBytes;
}
