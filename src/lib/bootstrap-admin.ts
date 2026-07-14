import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { localPasswordValidationError } from '@/lib/password-policy';

// The single admin every Helprr install starts with. Migration 0015 seeds this
// row (passwordHash NULL); this module hashes APP_PASSWORD into it on boot. The
// id is stable so per-user backfills (migration 0016) can attach existing data
// to it deterministically.
export const BOOTSTRAP_ADMIN_ID = 'user-bootstrap-admin';

/**
 * Idempotently ensure the bootstrap admin exists and can log in with APP_PASSWORD.
 *
 * - Migration path: the admin row already exists with passwordHash NULL → hash
 *   APP_PASSWORD into it once.
 * - `db push` path (no migration seed ran): the row is missing → create it.
 * - Already configured: leave the stored hash alone so a password the admin
 *   later set through the app is never clobbered on reboot.
 * - HELPRR_ADMIN_PASSWORD_RESET=true: force a re-hash from APP_PASSWORD, for
 *   shell-access recovery when the in-app password was lost.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    console.warn('[Helprr] APP_PASSWORD is not set — bootstrap admin local login will be unavailable');
    return;
  }

  const forceReset = process.env.HELPRR_ADMIN_PASSWORD_RESET === 'true';
  // The admin's login username is configurable; defaults to 'admin'. Strip stray
  // surrounding quotes (a common mistake when set via docker-compose `environment:`).
  const adminUsername =
    process.env.HELPRR_ADMIN_USERNAME?.trim().replace(/^["']|["']$/g, '').trim() || 'admin';
  console.log(`[Helprr] Bootstrap admin username resolves to "${adminUsername}"`);

  const existing = await prisma.user.findUnique({
    where: { id: BOOTSTRAP_ADMIN_ID },
    select: { id: true, passwordHash: true, username: true },
  });

  const needsPasswordHash = !existing || !existing.passwordHash || forceReset;
  if (needsPasswordHash) {
    const passwordError = localPasswordValidationError(appPassword);
    if (passwordError) {
      throw new Error(`APP_PASSWORD ${passwordError.slice('Password '.length).toLowerCase()}`);
    }
  }

  if (!existing) {
    const passwordHash = await hashPassword(appPassword);
    // upsert (not create) guards the rare race where two Node workers boot at once.
    await prisma.user.upsert({
      where: { id: BOOTSTRAP_ADMIN_ID },
      update: {},
      create: {
        id: BOOTSTRAP_ADMIN_ID,
        username: adminUsername,
        displayName: 'Admin',
        passwordHash,
        role: 'admin',
        status: 'active',
        template: 'admin',
      },
    });
    console.log(`[Helprr] Bootstrap admin created from APP_PASSWORD (username: ${adminUsername})`);
    // First-ever boot (db push path): attach any pre-existing single-tenant rows.
    await attachOwnerlessRowsToAdmin();
  } else if (!existing.passwordHash || forceReset) {
    const passwordHash = await hashPassword(appPassword);
    await prisma.user.update({
      where: { id: BOOTSTRAP_ADMIN_ID },
      data: { passwordHash },
    });
    console.log(
      forceReset
        ? '[Helprr] Bootstrap admin password reset from APP_PASSWORD (HELPRR_ADMIN_PASSWORD_RESET)'
        : '[Helprr] Bootstrap admin password seeded from APP_PASSWORD'
    );
    // Migration path (seeded admin had no hash): attach pre-existing rows. Only
    // runs on the upgrade boot, not on every steady-state reboot.
    await attachOwnerlessRowsToAdmin();
  }

  // Keep the admin's username in sync with HELPRR_ADMIN_USERNAME (renames on
  // change). Best-effort: a clash with another user's username is logged, not fatal.
  if (existing && existing.username !== adminUsername) {
    try {
      await prisma.user.update({
        where: { id: BOOTSTRAP_ADMIN_ID },
        data: { username: adminUsername },
      });
      console.log(`[Helprr] Bootstrap admin username set to "${adminUsername}"`);
    } catch (err) {
      console.warn(
        `[Helprr] Could not set bootstrap admin username to "${adminUsername}" (already in use?):`,
        err
      );
    }
  }
}

/**
 * Attach pre-existing single-tenant data to the bootstrap admin so the upgrade
 * to multi-user doesn't visibly drop anything (the single operator's sessions
 * stay logged in; their watchlist and push subscriptions stay theirs). Idempotent:
 * once everything has an owner these updates touch zero rows.
 */
async function attachOwnerlessRowsToAdmin(): Promise<void> {
  try {
    const [sessions, watchlist, subs] = await prisma.$transaction([
      prisma.session.updateMany({ where: { userId: null }, data: { userId: BOOTSTRAP_ADMIN_ID } }),
      prisma.watchlistItem.updateMany({ where: { userId: null }, data: { userId: BOOTSTRAP_ADMIN_ID } }),
      prisma.pushSubscription.updateMany({ where: { userId: null }, data: { userId: BOOTSTRAP_ADMIN_ID } }),
    ]);
    const total = sessions.count + watchlist.count + subs.count;
    if (total > 0) {
      console.log(
        `[Helprr] Attached ownerless rows to bootstrap admin (sessions=${sessions.count}, watchlist=${watchlist.count}, pushSubscriptions=${subs.count})`
      );
    }
  } catch (err) {
    console.warn('[Helprr] Could not attach ownerless rows to bootstrap admin:', err);
  }
}
