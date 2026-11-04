// The VAPID public key is runtime configuration so one prebuilt image works for
// every install (each has its own key pair). VAPID_PUBLIC_KEY is the canonical
// name; NEXT_PUBLIC_VAPID_PUBLIC_KEY is accepted for .env files from when the
// key was inlined at build time.
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

/**
 * The Web Push variables this install is missing. Push sends nothing unless all
 * three are set, though the public key alone lets a browser subscribe.
 */
export function missingVapidVariables(): string[] {
  const missing: string[] = [];
  if (!getVapidPublicKey()) missing.push('VAPID_PUBLIC_KEY');
  if (!process.env.VAPID_PRIVATE_KEY) missing.push('VAPID_PRIVATE_KEY');
  if (!process.env.VAPID_SUBJECT) missing.push('VAPID_SUBJECT');
  return missing;
}
