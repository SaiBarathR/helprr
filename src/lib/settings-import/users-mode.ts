// How a settings import matches the file's user accounts to this install's.
// The import dialog uses it to explain the choice and warn the importer; the
// server (users.ts) decides. Client-safe: no database access.

import { BOOTSTRAP_ADMIN_ID } from '@/lib/bootstrap-admin-id';
import { normalizeLocalUsername } from '@/lib/username-policy';

/**
 * - restore: the file's first admin replaces this install's; every other
 *   account matches by id, then username. Meant for a backup of this install.
 * - match-username: every account, the file's first admin too, matches by
 *   username only, and the rest are added. This install's first admin changes
 *   only when a file account has its username.
 * - keep-first-admin: as match-username, but this install's first admin is
 *   never changed.
 */
export const USERS_IMPORT_MODES = ['restore', 'match-username', 'keep-first-admin'] as const;
export type UsersImportMode = (typeof USERS_IMPORT_MODES)[number];

/** Preselected in the dialog: the only one that can never change the install's recovery admin. */
export const DEFAULT_USERS_IMPORT_MODE: UsersImportMode = 'keep-first-admin';

/**
 * The mode an import request asked for. A request without one was made before
 * the choice existed, when Restore was the only behaviour. Any other value is
 * null, and the request is refused.
 */
export function parseUsersImportMode(value: unknown): UsersImportMode | null {
  if (value === undefined) return 'restore';
  return (USERS_IMPORT_MODES as readonly unknown[]).includes(value) ? (value as UsersImportMode) : null;
}

export interface AccountInFileMatch {
  /** The username the account has afterwards. */
  username: string;
  /** The file carries a password for it, which replaces the account's. */
  hasPassword: boolean;
}

/** This install's other accounts, when known. */
export interface OtherAccounts {
  /** Restore skips an entry whose username one of them has. */
  usernames: ReadonlySet<string>;
  /** Restore matches an entry with one of their ids to that account first. */
  ids: ReadonlySet<string>;
}

/**
 * The file entry that would update `account` (an account on this install) in
 * `mode`, following the server's matching (users.ts), or null when the import
 * leaves it alone. Without `others`, a clash the file cannot show is assumed away.
 */
export function accountInFile(
  mode: UsersImportMode,
  accounts: readonly unknown[],
  account: { id: string; username?: string },
  others: OtherAccounts = { usernames: new Set(), ids: new Set() },
): AccountInFileMatch | null {
  const entries = accounts
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      id: typeof a.id === 'string' ? a.id : null,
      username: typeof a.username === 'string' ? normalizeLocalUsername(a.username) : '',
      hasPassword: typeof a.passwordHash === 'string' && a.passwordHash.length > 0,
    }))
    .filter((a) => a.username.length > 0);
  const sameName = (a: { username: string }) => account.username !== undefined && a.username === account.username;

  let match: (typeof entries)[number] | undefined;
  if (mode === 'restore') {
    // Its own entry by id (the first admin's fixed id, or this install's own
    // id in a same-install backup) first. Skipped for a username another
    // account has, it can still be reached by its current username, by an
    // entry whose id is not another account's here (that one goes there).
    const own = entries.find((a) => a.id === account.id);
    match = own && !others.usernames.has(own.username)
      ? own
      : entries.find((a) => a !== own && a.id !== BOOTSTRAP_ADMIN_ID && !(a.id && others.ids.has(a.id)) && sameName(a));
  } else if (!(mode === 'keep-first-admin' && account.id === BOOTSTRAP_ADMIN_ID)) {
    match = entries.find(sameName);
  }
  return match ? { username: match.username, hasPassword: match.hasPassword } : null;
}
