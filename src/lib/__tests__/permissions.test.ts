import { describe, it, expect } from 'vitest';
import { can, type PermissionUser } from '@/lib/permissions';
import { CAPABILITIES } from '@/lib/capabilities';

function member(permissions: unknown = {}): PermissionUser {
  return { role: 'member', template: 'member', permissions } as PermissionUser;
}

function admin(): PermissionUser {
  return { role: 'admin', template: 'admin', permissions: {} } as PermissionUser;
}

describe('capability resolution', () => {
  it('admins can do everything', () => {
    for (const cap of CAPABILITIES) {
      expect(can(admin(), cap)).toBe(true);
    }
  });

  it('members are fail-closed on destructive capabilities', () => {
    const m = member();
    expect(can(m, 'series.delete')).toBe(false);
    expect(can(m, 'movies.delete')).toBe(false);
    expect(can(m, 'music.delete')).toBe(false);
    expect(can(m, 'series.manageFiles')).toBe(false);
    expect(can(m, 'cleanup.manage')).toBe(false);
    expect(can(m, 'torrents.delete')).toBe(false);
  });

  it('members cannot create upstream tags by default (editTags)', () => {
    const m = member();
    expect(can(m, 'series.editTags')).toBe(false);
    expect(can(m, 'movies.editTags')).toBe(false);
    expect(can(m, 'music.editTags')).toBe(false);
  });

  it('members keep read access', () => {
    const m = member();
    expect(can(m, 'series.view')).toBe(true);
    expect(can(m, 'movies.view')).toBe(true);
    expect(can(m, 'music.view')).toBe(true);
  });

  it('a per-user override grants a capability the template denies', () => {
    const m = member({ 'series.delete': true });
    expect(can(m, 'series.delete')).toBe(true);
    // Other destructive caps stay denied.
    expect(can(m, 'movies.delete')).toBe(false);
  });

  it('a per-user override revokes a capability the template grants', () => {
    const m = member({ 'series.view': false });
    expect(can(m, 'series.view')).toBe(false);
  });

  it('malformed permission payloads are ignored, not trusted', () => {
    expect(can(member('not-an-object'), 'series.delete')).toBe(false);
    expect(can(member(null), 'series.delete')).toBe(false);
    expect(can(member({ 'series.delete': 'yes' }), 'series.delete')).toBe(false);
    expect(can(member({ 'not.a.capability': true }), 'series.delete')).toBe(false);
  });
});
