import { prisma } from '@/lib/db';
import { getVapidPublicKey } from '@/lib/vapid';

/**
 * Where the session secret and the push keys came from: .env, or helprr-init's
 * helprr-secrets volume (docker/init-secrets.sh, loaded by docker-entrypoint.sh).
 * Never the values.
 */
export interface SecretsStatus {
  sessionSecret: 'env' | 'generated';
  pushKeys: 'env' | 'generated' | 'missing';
  /** The session secret is newer than some user: the volume holding the old one was lost. */
  lostSecret: boolean;
}

const LOST_SECRET_WARNING_DAYS = 14;
// On globalThis: instrumentation and the route handlers load this module separately,
// so a module variable set at startup would not be seen by /api/admin/secrets.
const state = globalThis as typeof globalThis & { __helprrLostSecret?: boolean };

/**
 * At startup: when the generated session secret is younger than some user, the one
 * before it was lost (the helprr-secrets volume was removed or replaced). Stored
 * service tokens can no longer be read and every session ended. Said for two weeks
 * after the new secret was made; a fresh install never says it, since its users
 * come after the secret.
 */
export async function checkGeneratedSecretsAtStartup(now = Date.now()): Promise<void> {
  state.__helprrLostSecret = false;
  const createdAt = Number(process.env.HELPRR_JWT_SECRET_CREATED_AT) * 1000;
  if (process.env.HELPRR_JWT_SECRET_SOURCE !== 'generated' || !Number.isFinite(createdAt) || createdAt <= 0) return;
  if (now - createdAt > LOST_SECRET_WARNING_DAYS * 24 * 3600 * 1000) return;
  const older = await prisma.user.count({ where: { createdAt: { lt: new Date(createdAt) } } });
  if (older === 0) return;
  state.__helprrLostSecret = true;
  console.warn(
    '[Helprr] The session secret was just created, but users already existed. The helprr-secrets volume that held the old one was removed or replaced: stored service tokens cannot be read and everyone must sign in again. Restore the volume from a backup (scripts/backup.sh saves it beside each dump) to undo this.',
  );
}

export function secretsStatus(): SecretsStatus {
  const vapidGenerated = process.env.HELPRR_VAPID_SOURCE === 'generated';
  return {
    sessionSecret: process.env.HELPRR_JWT_SECRET_SOURCE === 'generated' ? 'generated' : 'env',
    pushKeys: vapidGenerated ? 'generated' : getVapidPublicKey() && process.env.VAPID_PRIVATE_KEY ? 'env' : 'missing',
    lostSecret: state.__helprrLostSecret === true,
  };
}
