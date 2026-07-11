// The VAPID public key is runtime configuration so one prebuilt image works for
// every install (each has its own key pair). VAPID_PUBLIC_KEY is the canonical
// name; NEXT_PUBLIC_VAPID_PUBLIC_KEY is accepted for .env files from when the
// key was inlined at build time.
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}
