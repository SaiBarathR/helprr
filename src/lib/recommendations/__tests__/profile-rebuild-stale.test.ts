import { beforeEach, describe, expect, it, vi } from 'vitest';

// `before` is the stored row as the build starts; `stored` as it writes.
type Row = { builtAt?: Date; updatedAt?: Date; markedAt: Date | null };
const db = vi.hoisted(() => ({
  before: null as null | Row,
  stored: null as null | Row,
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
  return {
    prisma: {
      userTasteProfile: { findUnique: vi.fn(async () => db.before) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
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
const written = () => db.upsert.mock.calls[0][0] as { update: Record<string, unknown> & { builtAt: Date }; create: Record<string, unknown> & { builtAt: Date } };
const storedBuiltAt = () => written().update.builtAt;
const fresh = () => expect(storedBuiltAt().getTime()).toBeGreaterThan(Date.now() - 5_000);
const minutes = (n: number) => new Date(Date.now() + n * 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  db.before = { markedAt: null };
  db.stored = { markedAt: null };
  db.current = { role: 'member', jellyfinUserId: 'jf-1' };
});

describe('rebuilding a taste profile', () => {
  it('stores it as fresh when nothing it read has moved', async () => {
    await rebuildTasteProfile(member);
    fresh();
  });

  it('stores it as fresh when the stale mark was what asked for this rebuild', async () => {
    db.before = db.stored = { builtAt: EPOCH, markedAt: minutes(-1) };
    await rebuildTasteProfile(member);
    fresh();
  });

  it('leaves it stale when a link was marked while it was building', async () => {
    db.before = { markedAt: minutes(-60) };
    db.stored = { builtAt: EPOCH, markedAt: minutes(-1) };
    await rebuildTasteProfile(member);
    expect(storedBuiltAt()).toEqual(EPOCH);
  });

  it('leaves it stale for a mark stamped before it started but committed after (an import transaction)', async () => {
    db.before = { markedAt: null };
    db.stored = { builtAt: EPOCH, markedAt: minutes(-5) };
    await rebuildTasteProfile(member);
    expect(storedBuiltAt()).toEqual(EPOCH);
  });

  it("is not fooled by another rebuild's stale write or a forget edit, which change the row but are not marks", async () => {
    db.before = { markedAt: minutes(-30) };
    db.stored = { builtAt: EPOCH, updatedAt: minutes(1), markedAt: db.before.markedAt };
    await rebuildTasteProfile(member);
    fresh();
  });

  it('never writes markedAt itself, so its own stale write cannot pass for a mark', async () => {
    db.current = { role: 'member', jellyfinUserId: 'jf-2' };
    await rebuildTasteProfile(member);
    expect(written().update).not.toHaveProperty('markedAt');
    expect(written().create).not.toHaveProperty('markedAt');
  });

  it('stores a first profile as fresh, and one for a user removed meanwhile as before', async () => {
    db.before = db.stored = null;
    await rebuildTasteProfile(member);
    expect(written().create.builtAt.getTime()).toBeGreaterThan(Date.now() - 5_000);

    db.upsert.mockClear();
    db.current = null;
    await rebuildTasteProfile(member);
    fresh();
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
