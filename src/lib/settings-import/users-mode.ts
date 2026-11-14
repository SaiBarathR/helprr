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

export interface ImporterAccountMatch {
  /** The username the importer signs in with afterwards. */
  username: string;
  /** The file carries a password for it, which replaces theirs. */
  hasPassword: boolean;
}

/**
 * The file account that would update the importer's own account in `mode`, as
 * far as the file shows (the server also skips clashes with other accounts),
 * or null when the import leaves it alone.
 */
export function importerAccountInFile(
  mode: UsersImportMode,
  accounts: readonly unknown[],
  importer: { id: string; username?: string },
): ImporterAccountMatch | null {
  const entries = accounts
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      id: typeof a.id === 'string' ? a.id : null,
      username: typeof a.username === 'string' ? normalizeLocalUsername(a.username) : '',
      hasPassword: typeof a.passwordHash === 'string' && a.passwordHash.length > 0,
    }))
    .filter((a) => a.username.length > 0);
  const sameName = (a: { username: string }) => importer.username !== undefined && a.username === importer.username;
  const isFirstAdmin = importer.id === BOOTSTRAP_ADMIN_ID;

  let match: (typeof entries)[number] | undefined;
  if (mode === 'restore') {
    match = isFirstAdmin
      ? entries.find((a) => a.id === BOOTSTRAP_ADMIN_ID) ?? entries.find((a) => a.id !== BOOTSTRAP_ADMIN_ID && sameName(a))
      : entries.find((a) => a.id === importer.id) ?? entries.find((a) => a.id !== BOOTSTRAP_ADMIN_ID && sameName(a));
  } else if (!(mode === 'keep-first-admin' && isFirstAdmin)) {
    match = entries.find(sameName);
  }
  return match ? { username: match.username, hasPassword: match.hasPassword } : null;
}
