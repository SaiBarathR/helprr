import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  stored: null as null | { builtAt: Date; updatedAt: Date },
  current: null as null | { role: string; jellyfinUserId: string | null },
  upsert: vi.fn(),
}));
vi.mock('@/lib/db', () => {
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => []),
    recommendationEvent: { findMany: vi.fn(async () => []) },
    userTasteProfile: { findUnique: vi.fn(async () => db.stored), upsert: db.upsert },
    user: { findUnique: vi.fn(async () => db.current) },
  };
  return { prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock('@/lib/recommendations/build-profile', () => ({
  buildTasteProfile: vi.fn(() => ({ negatives: { excludedItemKeys: [] }, likedItemKeys: [] })),
}));
vi.mock('@/lib/recommendations/signals', () => ({
  collectJellyfinSignals: vi.fn(async () => null),
  collectAniListSignals: vi.fn(async () => ({ available: false, engagedTitles: [], planned: [], listedAnilistIds: new Set() })),
  collectWatchlistSignals: vi.fn(async () => ({ available: false, items: [], itemKeys: new Set() })),
  collectEventSignals: vi.fn(async () => ({ hasEvents: false })),
}));

const { rebuildTasteProfile } = await import('../profile-store');

const member = { id: 'u1', role: 'member' as const, jellyfinUserId: 'jf-1' };
const EPOCH = new Date(0);
const storedBuiltAt = () => (db.upsert.mock.calls[0][0] as { update: { builtAt: Date } }).update.builtAt;

beforeEach(() => {
  vi.clearAllMocks();
  db.stored = { builtAt: new Date(Date.now() - 7 * 3600_000), updatedAt: new Date(Date.now() - 7 * 3600_000) };
  db.current = { role: 'member', jellyfinUserId: 'jf-1' };
});

describe('rebuilding a taste profile', () => {
  it('stores it as fresh when nothing it read has moved', async () => {
    await rebuildTasteProfile(member);
    expect(storedBuiltAt().getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it('stores it as fresh when the stale mark was what asked for this rebuild', async () => {
    db.stored = { builtAt: EPOCH, updatedAt: new Date(Date.now() - 60_000) };
    await rebuildTasteProfile(member);
    expect(storedBuiltAt().getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it('leaves it stale when a link was marked while it was building', async () => {
    db.stored = { builtAt: EPOCH, updatedAt: new Date(Date.now() + 60_000) };
    await rebuildTasteProfile(member);
    expect(storedBuiltAt()).toEqual(EPOCH);
  });

  it("leaves it stale when the user it was given is older than the user's link or role", async () => {
    db.current = { role: 'member', jellyfinUserId: 'jf-2' };
    await rebuildTasteProfile(member);
    expect(storedBuiltAt()).toEqual(EPOCH);

    db.upsert.mockClear();
    db.current = { role: 'admin', jellyfinUserId: 'jf-1' };
    await rebuildTasteProfile(member);
    expect(storedBuiltAt()).toEqual(EPOCH);
  });
});
