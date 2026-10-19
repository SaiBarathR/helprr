import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updateMany: vi.fn(), redisSet: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { userTasteProfile: { updateMany: mocks.updateMany } } }));
vi.mock('@/lib/redis', () => ({ getRedisClient: async () => ({ set: mocks.redisSet }) }));

const { refreshRecommendationsAfterLink } = await import('../engine');
const { markTasteProfileStale } = await import('../profile-store');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.redisSet.mockResolvedValue('OK');
});

describe('after a link change', () => {
  it("marks the user's profile stale, for a rebuild on next use, and drops the composed rails", async () => {
    await refreshRecommendationsAfterLink('u1');
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { builtAt: new Date(0) } });
    expect(mocks.redisSet).toHaveBeenCalledTimes(1);
    expect(mocks.redisSet.mock.calls[0][0]).toContain('u1');
  });

  it("marks several users at once, in a caller's transaction", async () => {
    const tx = { userTasteProfile: { updateMany: vi.fn(async () => ({ count: 2 })) } };
    await markTasteProfileStale(['u1', 'u2'], tx as never);
    expect(tx.userTasteProfile.updateMany).toHaveBeenCalledWith({ where: { userId: { in: ['u1', 'u2'] } }, data: { builtAt: new Date(0) } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
