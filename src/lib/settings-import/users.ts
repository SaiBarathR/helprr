// User accounts section of a settings import.

import type { Prisma, ScheduledAlert, UserRole, UserStatus } from '@prisma/client';
import { BOOTSTRAP_ADMIN_ID } from '@/lib/bootstrap-admin';
import { isValidTimeZone } from '@/lib/timezone';
import { parsePermissions } from '@/lib/permissions';
import {
  USER_ROLE_VALUES,
  USER_STATUS_VALUES,
  USER_TEMPLATE_VALUES,
  type ExportedUsers,
} from '@/lib/settings-export';
import { resolveImportedPasswordHash } from '@/lib/settings-import-validation';
import { localUsernameValidationError, normalizeLocalUsername } from '@/lib/username-policy';
import {
  UPCOMING_NOTIFY_MODES,
  ACTIVITY_DIGEST_MODES,
  coerceIntOrNull,
  clampHourOrNull,
  pickEnum,
} from './shared';
import { applyUserDashboardLayoutsInTxn } from './layouts';
import { applyPreparedWatchlist, prepareWatchlist, type PreparedWatchlist } from './watchlist';
import { applyPreparedScheduledAlerts, prepareScheduledAlerts, type PreparedAlert } from './alerts';
import { markTasteProfileStale } from '@/lib/recommendations/profile-store';

export interface PreparedAccountContent {
  watchlist: PreparedWatchlist | null;
  alerts: PreparedAlert[] | null;
}

/**
 * Validate and normalize each account's own watchlist and alerts before the
 * transaction opens. Accounts whose username is invalid are skipped later, so
 * their content is not prepared.
 */
export function prepareAccountContent(data: ExportedUsers, skipped: string[]): Map<unknown, PreparedAccountContent> {
  const prepared = new Map<unknown, PreparedAccountContent>();
  if (!Array.isArray(data.accounts)) return prepared;
  for (const acc of data.accounts) {
    if (!acc || typeof acc !== 'object') continue;
    const username = typeof acc.username === 'string' ? normalizeLocalUsername(acc.username) : '';
    if (localUsernameValidationError(username)) continue;
    prepared.set(acc, {
      watchlist: acc.watchlist && typeof acc.watchlist === 'object' ? prepareWatchlist(acc.watchlist, skipped) : null,
      alerts: Array.isArray(acc.scheduledAlerts)
        ? prepareScheduledAlerts(acc.scheduledAlerts, skipped, `User "${username}"`)
        : null,
    });
  }
  return prepared;
}

export async function applyUsersInTxn(
  tx: Prisma.TransactionClient,
  data: ExportedUsers,
  skipped: string[],
  importerId: string,
  createdReleaseRelative: ScheduledAlert[],
  content: Map<unknown, PreparedAccountContent>,
): Promise<number> {
  if (!Array.isArray(data.accounts)) {
    skipped.push('Users: missing accounts array');
    return 0;
  }

  let applied = 0;
  const updatedUserIds: string[] = [];
  for (const acc of data.accounts) {
    if (!acc || typeof acc !== 'object') continue;
    const username = typeof acc.username === 'string'
      ? normalizeLocalUsername(acc.username)
      : '';
    const usernameError = localUsernameValidationError(username);
    if (usernameError) {
      skipped.push(`User skipped: ${usernameError.toLowerCase()}`);
      continue;
    }
    const exportedId = typeof acc.id === 'string' && acc.id.length > 0 ? acc.id : null;
    const isBootstrap = exportedId === BOOTSTRAP_ADMIN_ID;

    // Identity: the bootstrap admin matches by its fixed id; everyone else by id
    // first (clean re-attach on a same-install restore), then by username.
    let target = null as Awaited<ReturnType<typeof tx.user.findUnique>>;
    if (isBootstrap) {
      target = await tx.user.findUnique({ where: { id: BOOTSTRAP_ADMIN_ID } });
    } else {
      if (exportedId) target = await tx.user.findUnique({ where: { id: exportedId } });
      if (!target) target = await tx.user.findUnique({ where: { username } });
    }
    const targetId = target?.id ?? exportedId ?? undefined;

    let role = pickEnum(acc.role, USER_ROLE_VALUES, 'member');
    let status = pickEnum(acc.status, USER_STATUS_VALUES, 'active');
    let template = pickEnum(acc.template, USER_TEMPLATE_VALUES, role === 'admin' ? 'admin' : 'member');
    // The bootstrap admin is the guaranteed recovery account — never let an import
    // file demote or disable it (a hand-edited or hostile backup could otherwise lock
    // every admin out). Force its role/status/template back to the secure defaults.
    if (isBootstrap) {
      role = 'admin';
      status = 'active';
      template = 'admin';
    } else if (target && target.id === importerId) {
      // The admin performing the import must not be able to lock themselves out
      // by restoring a backup that demotes or disables their own account.
      // Preserve their existing role/template and force status active, ignoring
      // whatever the file says. (The bootstrap admin is already pinned above.)
      role = target.role;
      status = 'active';
      template = target.template;
      skipped.push(
        `User "${username}": role/status preserved — an import can't demote or disable the account performing it.`
      );
    }
    const permissions = parsePermissions(acc.permissions);
    const displayName =
      typeof acc.displayName === 'string' && acc.displayName.trim().length > 0
        ? acc.displayName.trim()
        : username;

    // Unique-column collision guards — a violation here would roll back the
    // whole import, so pre-check username/jellyfin/seerr against other rows.
    const usernameOwner = await tx.user.findUnique({ where: { username }, select: { id: true } });
    if (usernameOwner && usernameOwner.id !== targetId) {
      skipped.push(`User "${username}" skipped: username already belongs to another account`);
      continue;
    }

    let jellyfinUserId =
      typeof acc.jellyfinUserId === 'string' && acc.jellyfinUserId.length > 0 ? acc.jellyfinUserId : null;
    if (jellyfinUserId) {
      const owner = await tx.user.findUnique({ where: { jellyfinUserId }, select: { id: true } });
      if (owner && owner.id !== targetId) {
        skipped.push(`User "${username}": Jellyfin link dropped (already linked to another account)`);
        jellyfinUserId = null;
      }
    }
    let seerrUserId =
      typeof acc.seerrUserId === 'string' && acc.seerrUserId.length > 0 ? acc.seerrUserId : null;
    if (seerrUserId) {
      const owner = await tx.user.findUnique({ where: { seerrUserId }, select: { id: true } });
      if (owner && owner.id !== targetId) {
        skipped.push(`User "${username}": Seerr link dropped (already linked to another account)`);
        seerrUserId = null;
      }
    }

    // Password: accept only bounded Helprr scrypt hashes. A malformed or
    // attacker-amplified cost string must never replace a working credential or
    // make login spend unbounded CPU/memory.
    const importedPassword = resolveImportedPasswordHash(acc.passwordHash, target?.passwordHash);
    const passwordHash = importedPassword.passwordHash;
    if (importedPassword.rejected) {
      skipped.push(`User "${username}": invalid password hash dropped`);
    }

    const baseData = {
      username,
      displayName,
      role: role as UserRole,
      status: status as UserStatus,
      template,
      permissions: permissions as unknown as Prisma.InputJsonValue,
      jellyfinUserId,
      seerrUserId,
      passwordHash,
    };

    let userId: string;
    if (target) {
      await tx.user.update({ where: { id: target.id }, data: baseData });
      userId = target.id;
      // Restoring a different password hash for an existing account must not
      // leave old cookies valid (disaster-recovery / post-compromise restore).
      // Revoke the account's live sessions when the hash actually changes.
      if (passwordHash && passwordHash !== target.passwordHash) {
        await tx.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } else {
      const created = await tx.user.create({
        data: { ...(exportedId ? { id: exportedId } : {}), ...baseData },
      });
      userId = created.id;
    }
    applied += 1;

    // Per-user settings. Nullable string fields are validated lightly; the
    // default-layout choices are restored by name further down, once this
    // user's own layouts have been recreated.
    if (acc.settings && typeof acc.settings === 'object') {
      const s = acc.settings;
      const timeZone =
        typeof s.timeZone === 'string' && isValidTimeZone(s.timeZone) ? s.timeZone : null;
      const settingsData = {
        timeZone,
        upcomingNotifyMode:
          typeof s.upcomingNotifyMode === 'string' && UPCOMING_NOTIFY_MODES.has(s.upcomingNotifyMode)
            ? s.upcomingNotifyMode
            : null,
        activityDigestMode:
          typeof s.activityDigestMode === 'string' && ACTIVITY_DIGEST_MODES.has(s.activityDigestMode)
            ? s.activityDigestMode
            : null,
        quietHoursEnabled: Boolean(s.quietHoursEnabled),
        quietHoursStart: clampHourOrNull(s.quietHoursStart),
        quietHoursEnd: clampHourOrNull(s.quietHoursEnd),
      };
      await tx.userSettings.upsert({
        where: { userId },
        update: settingsData,
        create: { userId, ...settingsData },
      });
    }

    // AniList identity only — tokens are left null (install-bound), so the user
    // re-authenticates after import.
    if (acc.anilist && typeof acc.anilist === 'object') {
      const a = acc.anilist;
      const linkData = {
        anilistUserId: coerceIntOrNull(a.anilistUserId),
        username: typeof a.username === 'string' ? a.username : null,
        avatar: typeof a.avatar === 'string' ? a.avatar : null,
        siteUrl: typeof a.siteUrl === 'string' ? a.siteUrl : null,
        scoreFormat: typeof a.scoreFormat === 'string' ? a.scoreFormat : null,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
      };
      await tx.userAniListLink.upsert({
        where: { userId },
        update: linkData,
        create: { userId, ...linkData },
      });
    }

    if (target) updatedUserIds.push(userId);

    // v2 per-account content: this user's watchlist, scheduled alerts, and
    // personal dashboard layouts. All optional — absent in v1 files.
    const ownerLabel = `User "${username}"`;
    const prepared = content.get(acc);
    if (prepared?.watchlist) {
      await applyPreparedWatchlist(tx, prepared.watchlist, userId);
    }
    if (prepared?.alerts) {
      await applyPreparedScheduledAlerts(tx, prepared.alerts, userId, createdReleaseRelative);
    }
    if (Array.isArray(acc.dashboardLayouts)) {
      await applyUserDashboardLayoutsInTxn(tx, acc.dashboardLayouts, skipped, userId, ownerLabel);
    }

    // Default-layout choices travel by name (ids are install-local). Resolve
    // against the user's own layouts first, then the global ones — a member
    // may have picked a shared built-in as their default.
    if (acc.settings && typeof acc.settings === 'object') {
      // Explicit null in the export means "no default" — clear it (null).
      // An absent field or a name that no longer resolves on this install is
      // left untouched (undefined).
      const resolveLayoutId = async (rawName: unknown): Promise<string | null | undefined> => {
        if (rawName === null) return null;
        const name = typeof rawName === 'string' ? rawName.trim() : '';
        if (!name) return undefined;
        const own = await tx.dashboardLayout.findFirst({
          where: { userId, name },
          select: { id: true },
        });
        if (own) return own.id;
        const global = await tx.dashboardLayout.findFirst({
          where: { userId: null, name },
          select: { id: true },
        });
        return global?.id ?? undefined;
      };
      const [desktopId, mobileId] = await Promise.all([
        resolveLayoutId(acc.settings.defaultDesktopLayoutName),
        resolveLayoutId(acc.settings.defaultMobileLayoutName),
      ]);
      if (desktopId !== undefined || mobileId !== undefined) {
        await tx.userSettings.upsert({
          where: { userId },
          update: {
            ...(desktopId !== undefined ? { defaultDesktopLayoutId: desktopId } : {}),
            ...(mobileId !== undefined ? { defaultMobileLayoutId: mobileId } : {}),
          },
          create: {
            userId,
            defaultDesktopLayoutId: desktopId ?? null,
            defaultMobileLayoutId: mobileId ?? null,
          },
        });
      }
    }
  }
  // An existing user's Jellyfin user and AniList link may have just changed,
  // and the taste profile reads both: rebuild those on their next use. One
  // statement for all of them, inside the import's time-limited transaction.
  if (updatedUserIds.length > 0) await markTasteProfileStale(updatedUserIds, tx);
  return applied;
}
