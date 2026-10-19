import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  userFindUnique: vi.fn(),
  txUserUpdate: vi.fn(),
  refreshRecommendations: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/recommendations/engine', () => ({ refreshRecommendationsAfterLink: mocks.refreshRecommendations }));
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    $transaction: async (callback: (tx: unknown) => unknown) => callback({ user: { update: mocks.txUserUpdate, count: vi.fn() } }),
  },
}));

import { PATCH as updateUser } from '@/app/api/users/[id]/route';

const member = {
  id: 'user-1', username: 'member', displayName: 'Member', passwordHash: null, role: 'member', status: 'active',
  template: 'member', permissions: {}, jellyfinUserId: 'jf-old', seerrUserId: null, jellyfinToken: null,
  createdAt: new Date('2026-07-14T00:00:00Z'), updatedAt: new Date('2026-07-14T00:00:00Z'),
};

const patch = (body: unknown) => updateUser(
  new NextRequest('http://localhost/api/users/user-1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: 'user-1' }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: 'admin-1', role: 'admin' }, session: { id: 's' } });
  mocks.userFindUnique.mockResolvedValue(member);
  mocks.txUserUpdate.mockImplementation(async ({ data }: { data: object }) => ({ ...member, ...data }));
  mocks.refreshRecommendations.mockResolvedValue(undefined);
});

describe("an admin changing a user's Jellyfin link", () => {
  it("rebuilds the user's recommendations on next use when the link changes or is cleared", async () => {
    expect((await patch({ jellyfinUserId: 'jf-new' })).status).toBe(200);
    expect(mocks.refreshRecommendations).toHaveBeenCalledWith('user-1');
    mocks.refreshRecommendations.mockClear();
    expect((await patch({ jellyfinUserId: '' })).status).toBe(200);
    expect(mocks.refreshRecommendations).toHaveBeenCalledWith('user-1');
  });

  it('leaves recommendations alone when the link stays the same or is not part of the change', async () => {
    expect((await patch({ jellyfinUserId: 'jf-old' })).status).toBe(200);
    expect((await patch({ displayName: 'Renamed' })).status).toBe(200);
    expect(mocks.refreshRecommendations).not.toHaveBeenCalled();
  });

  it('still saves the user when recommendations cannot be refreshed', async () => {
    mocks.refreshRecommendations.mockRejectedValue(new Error('db down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await patch({ jellyfinUserId: 'jf-new' });
    quiet.mockRestore();
    expect(res.status).toBe(200);
    expect((await res.json()).jellyfinUserId).toBe('jf-new');
  });
});
