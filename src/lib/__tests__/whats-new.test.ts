import { beforeEach, describe, expect, it, vi } from 'vitest';

// One user's UserSettings row, as the database would hold it.
const db = vi.hoisted(() => ({ row: null as { lastSeenVersion: string | null } | null }));

vi.mock('@/lib/db', () => ({
  prisma: {
    userSettings: {
      findUnique: vi.fn(async () => db.row),
      upsert: vi.fn(async ({ create, update }: { create: { lastSeenVersion: string }; update: { lastSeenVersion: string } }) => {
        db.row = db.row ? { ...db.row, ...update } : { lastSeenVersion: create.lastSeenVersion };
      }),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/db';
import { getCurrentReleaseNotes, getWhatsNew, markWhatsNewSeen, WHATS_NEW_MAX_RELEASES } from '@/lib/whats-new';

describe('whats-new', () => {
  beforeEach(() => {
    db.row = null;
    vi.clearAllMocks();
  });

  it('shows nothing on the first visit, and only records the running version', async () => {
    expect((await getWhatsNew('u1', '1.14.0')).releases).toEqual([]);
    expect(db.row).toEqual({ lastSeenVersion: '1.14.0' });
    // An existing settings row without a version is a first visit too.
    db.row = { lastSeenVersion: null };
    expect((await getWhatsNew('u1', '1.14.0')).releases).toEqual([]);
    expect(db.row).toEqual({ lastSeenVersion: '1.14.0' });
  });

  it('shows the notes since the last seen version once, and not again after dismissing', async () => {
    db.row = { lastSeenVersion: '1.13.0' };
    const notes = await getWhatsNew('u1', '1.14.0');
    expect(notes.version).toBe('1.14.0');
    expect(notes.releases.map((release) => release.version)).toEqual(['1.14.0', '1.13.1']);
    // Not dismissed yet: it is still due (another device, a reload).
    expect((await getWhatsNew('u1', '1.14.0')).releases).toHaveLength(2);

    await markWhatsNewSeen('u1', '1.14.0');
    expect(db.row).toEqual({ lastSeenVersion: '1.14.0' });
    expect((await getWhatsNew('u1', '1.14.0')).releases).toEqual([]);
  });

  it('only moves the seen version forward', async () => {
    db.row = { lastSeenVersion: '1.14.0' };
    await markWhatsNewSeen('u1', '1.13.1');
    expect(db.row).toEqual({ lastSeenVersion: '1.14.0' });
    await markWhatsNewSeen('u1', '1.14.0');
    expect(prisma.userSettings.upsert).not.toHaveBeenCalled();
  });

  it('falls back to an update when two first writes race', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(prisma.userSettings.upsert).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
    );
    await markWhatsNewSeen('u1', '1.14.0');
    expect(prisma.userSettings.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { lastSeenVersion: '1.14.0' } });
  });

  it('shows nothing after a downgrade', async () => {
    db.row = { lastSeenVersion: '1.14.0' };
    expect((await getWhatsNew('u1', '1.13.1')).releases).toEqual([]);
    expect(prisma.userSettings.upsert).not.toHaveBeenCalled();
  });

  it('ignores branch and local builds without a release version', async () => {
    db.row = { lastSeenVersion: '1.13.0' };
    expect((await getWhatsNew('u1', 'development')).releases).toEqual([]);
    await markWhatsNewSeen('u1', 'development');
    expect(prisma.userSettings.findUnique).not.toHaveBeenCalled();
    expect(prisma.userSettings.upsert).not.toHaveBeenCalled();
    expect((await getCurrentReleaseNotes('development')).releases).toEqual([]);
  });

  it('caps a long jump and says how many releases were left out', async () => {
    db.row = { lastSeenVersion: '1.0.0' };
    const notes = await getWhatsNew('u1', '1.14.0');
    expect(notes.releases).toHaveLength(WHATS_NEW_MAX_RELEASES);
    expect(notes.releases[0].version).toBe('1.14.0');
    expect(notes.omitted).toBeGreaterThan(0);
  });

  it("gives Settings → About the running release's own notes", async () => {
    const notes = await getCurrentReleaseNotes('1.13.1');
    expect(notes.releases.map((release) => release.version)).toEqual(['1.13.1']);
    expect(prisma.userSettings.findUnique).not.toHaveBeenCalled();
  });
});
