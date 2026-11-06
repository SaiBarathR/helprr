import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));

import { diffSeriesEdit } from '@/lib/library-edit-guard';

describe('series edit guard', () => {
  const current = { path: '/tv/Show', monitored: true, tags: [], seasons: [], monitorNewItems: 'all' };

  it('flags a changed Monitor New Seasons as an admin-only field', () => {
    expect(diffSeriesEdit(current, { ...current, monitorNewItems: 'none' }).other).toBe(true);
  });

  it('lets an unchanged Monitor New Seasons through', () => {
    expect(diffSeriesEdit(current, { ...current }).other).toBe(false);
  });
});
