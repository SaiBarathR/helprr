import { prisma } from '@/lib/db';
import { BOOTSTRAP_ADMIN_ID } from '@/lib/bootstrap-admin';
import { verifyPasswordHash } from '@/lib/password';
import { needsFirstAdmin } from '@/lib/first-admin';

/**
 * How a new installer can sign in, decided from the database:
 * - `create-admin`: no user at all and no APP_PASSWORD, so the first admin is
 *   created in the browser at /setup;
 * - `app-password`: the bootstrap admin is an active admin whose stored
 *   password still matches APP_PASSWORD;
 * - `admin-account`: some active admin has a local password, but not that one;
 * - `app-password-invalid`: APP_PASSWORD is set but made no usable admin
 *   (startup logged why, for example a password that is too short);
 * - `no-admin`: APP_PASSWORD is not set, users exist, and none of them is an
 *   admin who can sign in.
 */
export type SignInHint =
  | { kind: 'create-admin' }
  | { kind: 'app-password'; username: string }
  | { kind: 'admin-account' }
  | { kind: 'app-password-invalid' }
  | { kind: 'no-admin' };

/**
 * A few lines at the end of startup that tell a new installer what to do next.
 * Shown only while nobody is signed in. Never prints a secret.
 */
export function startupGuideLines(input: { port: string; inDocker: boolean; signIn: SignInHint }): string[] {
  const where = input.inDocker
    ? `http://YOUR-SERVER:${input.port} (or the host port you published for it)`
    : `http://localhost:${input.port}`;
  const lines = [`[Helprr] Ready. Open ${where} in a browser.`];
  switch (input.signIn.kind) {
    case 'create-admin':
      lines.push('[Helprr] Open it and create your admin account. Do that before Helprr is reachable from the internet.');
      break;
    case 'app-password':
      lines.push(`[Helprr] Sign in as "${input.signIn.username}" with the APP_PASSWORD from your .env file.`);
      break;
    case 'admin-account':
      lines.push('[Helprr] Sign in with your admin account.');
      break;
    case 'app-password-invalid':
      lines.push('[Helprr] No admin can sign in yet: APP_PASSWORD did not create one (see the warning above). Fix it in your .env file, then restart Helprr.');
      break;
    case 'no-admin':
      lines.push('[Helprr] No admin can sign in yet: set APP_PASSWORD in your .env file, then restart Helprr.');
      break;
  }
  lines.push('[Helprr] Push notifications on a phone need Helprr on an https:// address. This guide stops after the first sign-in.');
  return lines;
}

async function signInHint(): Promise<SignInHint> {
  if (await needsFirstAdmin()) return { kind: 'create-admin' };
  const appPassword = process.env.APP_PASSWORD;
  const bootstrap = await prisma.user.findUnique({
    where: { id: BOOTSTRAP_ADMIN_ID },
    select: { username: true, passwordHash: true, role: true, status: true },
  });
  if (
    appPassword
    && bootstrap?.role === 'admin'
    && bootstrap.status === 'active'
    && bootstrap.passwordHash
    && (await verifyPasswordHash(appPassword, bootstrap.passwordHash))
  ) {
    return { kind: 'app-password', username: bootstrap.username };
  }
  const localAdmins = await prisma.user.count({
    where: { role: 'admin', status: 'active', passwordHash: { not: null } },
  });
  if (localAdmins > 0) return { kind: 'admin-account' };
  return appPassword ? { kind: 'app-password-invalid' } : { kind: 'no-admin' };
}

export async function logStartupGuide(): Promise<void> {
  if ((await prisma.session.count()) > 0) return;
  const lines = startupGuideLines({
    port: process.env.PORT || '3050',
    inDocker: process.env.HELPRR_RUNTIME === 'docker',
    signIn: await signInHint(),
  });
  for (const line of lines) console.log(line);
}
