import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_ADMIN_ID } from '@/lib/bootstrap-admin-id';
import { DEFAULT_USERS_IMPORT_MODE, accountInFile, parseUsersImportMode } from './users-mode';

describe('parseUsersImportMode', () => {
  it('reads a request without a mode as Restore, the only behaviour before the choice', () => {
    expect(parseUsersImportMode(undefined)).toBe('restore');
  });

  it.each(['restore', 'match-username', 'keep-first-admin'])('accepts %s', (mode) => {
    expect(parseUsersImportMode(mode)).toBe(mode);
  });

  it.each([null, '', 'RESTORE', 'merge', 1, {}, ['restore']])('refuses %j', (value) => {
    expect(parseUsersImportMode(value)).toBeNull();
  });

  it('preselects the mode that never changes the first admin', () => {
    expect(DEFAULT_USERS_IMPORT_MODE).toBe('keep-first-admin');
  });
});

describe('accountInFile', () => {
  const firstAdmin = { id: BOOTSTRAP_ADMIN_ID, username: 'admin' };
  const otherAdmin = { id: 'cuid-boss', username: 'boss' };
  const file = [
    { id: BOOTSTRAP_ADMIN_ID, username: 'owner', passwordHash: 'scrypt$x' },
    { id: 'cuid-other', username: ' boss ' },
    { id: 'cuid-member', username: 'admin', passwordHash: 'scrypt$y' },
    null,
    'junk',
    { id: 'cuid-blank', username: '   ' },
  ];

  it("Restore: the file's first admin replaces this install's first admin", () => {
    expect(accountInFile('restore', file, firstAdmin)).toEqual({ username: 'owner', hasPassword: true });
  });

  it('Restore: another account is matched by id first, then by username', () => {
    expect(accountInFile('restore', [{ id: 'cuid-boss', username: 'renamed' }], otherAdmin))
      .toEqual({ username: 'renamed', hasPassword: false });
    expect(accountInFile('restore', file, otherAdmin)).toEqual({ username: 'boss', hasPassword: false });
  });

  it("Restore: when the file's first-admin name belongs to another account here, the same-named entry reaches the first admin instead", () => {
    expect(accountInFile('restore', file, firstAdmin, new Set(['owner', 'bob']))).toEqual({ username: 'admin', hasPassword: true });
    expect(accountInFile('restore', [file[0]], firstAdmin, new Set(['owner']))).toBeNull();
  });

  it('Match by username: the first admin changes only through its own username', () => {
    expect(accountInFile('match-username', file, firstAdmin)).toEqual({ username: 'admin', hasPassword: true });
    expect(accountInFile('match-username', [file[0]], firstAdmin)).toBeNull();
  });

  it("Keep this install's first admin: never the first admin, other accounts by username", () => {
    expect(accountInFile('keep-first-admin', file, firstAdmin)).toBeNull();
    expect(accountInFile('keep-first-admin', file, otherAdmin)).toEqual({ username: 'boss', hasPassword: false });
  });

  it('an account without a local username is matched by id in Restore only', () => {
    expect(accountInFile('match-username', file, { id: 'jf-only' })).toBeNull();
    expect(accountInFile('restore', [{ id: 'jf-only', username: 'x' }], { id: 'jf-only' })).toEqual({ username: 'x', hasPassword: false });
  });
});
