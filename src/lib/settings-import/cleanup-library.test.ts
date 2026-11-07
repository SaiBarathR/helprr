import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { applyCleanupInTxn } from './cleanup';
import { DEFAULT_LIBRARY_CLEANUP_SETTINGS } from '@/lib/library-cleanup/config';
import type { ExportedCleanup } from '@/lib/settings-export';

function fakeTx() {
  const upsert = vi.fn();
  const tx = {
    queueCleanerConfig: { upsert: vi.fn() },
    downloadCleanerConfig: { upsert: vi.fn() },
    libraryCleanupConfig: { upsert },
  } as unknown as Prisma.TransactionClient;
  return { tx, upsert };
}

const base = { queueConfig: {}, downloadConfig: {}, stallRules: [], slowRules: [], seedingRules: [] } as unknown as ExportedCleanup;

describe('settings import: library cleanup', () => {
  it('restores valid library cleanup settings', async () => {
    const { tx, upsert } = fakeTx();
    const skipped: string[] = [];
    const libraryConfig = { ...DEFAULT_LIBRARY_CLEANUP_SETTINGS, keepTag: 'keeper', countdownDays: 30 };
    await applyCleanupInTxn(tx, { ...base, libraryConfig }, skipped);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'singleton' },
      update: expect.objectContaining({ keepTag: 'keeper', countdownDays: 30 }),
    }));
    expect(skipped).toEqual([]);
  });

  it('skips an invalid block and leaves the current settings', async () => {
    const { tx, upsert } = fakeTx();
    const skipped: string[] = [];
    await applyCleanupInTxn(tx, { ...base, libraryConfig: { ...DEFAULT_LIBRARY_CLEANUP_SETTINGS, countdownDays: 0 } }, skipped);
    expect(upsert).not.toHaveBeenCalled();
    expect(skipped[0]).toMatch(/libraryConfig skipped/);
  });

  it('leaves the settings alone for an older export without the block', async () => {
    const { tx, upsert } = fakeTx();
    await applyCleanupInTxn(tx, base, []);
    expect(upsert).not.toHaveBeenCalled();
  });
});
