import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { localPasswordValidationError } from '@/lib/password-policy';
import {
  localUsernameValidationError,
  normalizeLocalUsername,
} from '@/lib/username-policy';

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
 *   shell-access recovery when the in-app password was lost. It also signs the
 *   admin out everywhere and ends their outstanding password link and calendar
 *   feed link.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    // With no user at all, the first admin is created in the browser (/setup).
    console.log('[Helprr] APP_PASSWORD is not set: the bootstrap admin is not created from it');
    return;
  }

  const forceReset = process.env.HELPRR_ADMIN_PASSWORD_RESET === 'true';
  // The admin's login username is configurable; defaults to 'admin'. Strip stray
  // surrounding quotes (a common mistake when set via docker-compose `environment:`).
  const adminUsername = normalizeLocalUsername(
    process.env.HELPRR_ADMIN_USERNAME?.trim().replace(/^["']|["']$/g, '').trim() || 'admin',
  );
  const usernameError = localUsernameValidationError(adminUsername);
  if (usernameError) {
    throw new Error(
      `HELPRR_ADMIN_USERNAME ${usernameError.slice('Username '.length).toLowerCase()}`,
    );
  }
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
  } else if (forceReset) {
    const passwordHash = await hashPassword(appPassword);
    // Recovery: whoever knew the old password may still hold a session, an
    // unused reset link or the calendar feed link, so end them all with the new
    // password, in one transaction.
    // Owner-less sessions are revoked too: the attach below would otherwise
    // hand them to the admin.
    const now = new Date();
    const [, links, sessions, feeds] = await prisma.$transaction([
      prisma.user.update({ where: { id: BOOTSTRAP_ADMIN_ID }, data: { passwordHash } }),
      prisma.passwordLink.deleteMany({ where: { userId: BOOTSTRAP_ADMIN_ID } }),
      prisma.session.updateMany({
        where: { OR: [{ userId: BOOTSTRAP_ADMIN_ID }, { userId: null }], revokedAt: null },
        data: { revokedAt: now },
      }),
      prisma.calendarFeedToken.deleteMany({ where: { userId: BOOTSTRAP_ADMIN_ID } }),
    ]);
    console.log(
      `[Helprr] Bootstrap admin password reset from APP_PASSWORD (HELPRR_ADMIN_PASSWORD_RESET); signed out ${sessions.count} session(s), ended ${links.count} link(s) and ${feeds.count} calendar feed link(s). Remove HELPRR_ADMIN_PASSWORD_RESET now: while it is set, every start does this again.`
    );
    await attachOwnerlessRowsToAdmin();
  } else if (!existing.passwordHash) {
    const passwordHash = await hashPassword(appPassword);
    await prisma.user.update({
      where: { id: BOOTSTRAP_ADMIN_ID },
      data: { passwordHash },
    });
    console.log('[Helprr] Bootstrap admin password seeded from APP_PASSWORD');
    // Migration path (seeded admin had no hash): attach pre-existing rows. Only
    // runs on the upgrade boot, not on every steady-state reboot.
    await attachOwnerlessRowsToAdmin();
  }

  // Keep the admin's username in sync with HELPRR_ADMIN_USERNAME (renames on
  // change), only when it is set: an admin created in /setup keeps the name chosen
  // there if APP_PASSWORD is set later for a reset. Best-effort: a clash with
  // another user's username is logged, not fatal.
  // Normalised as the name itself is, so a quoted empty value counts as unset.
  const usernameConfigured = Boolean(process.env.HELPRR_ADMIN_USERNAME?.trim().replace(/^["']|["']$/g, '').trim());
  if (existing && usernameConfigured && existing.username !== adminUsername) {
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
export async function attachOwnerlessRowsToAdmin(): Promise<void> {
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
