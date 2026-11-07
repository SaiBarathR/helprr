import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { applyCleanupInTxn } from '@/lib/settings-import/cleanup';
import type { ExportedCleanup } from '@/lib/settings-export';

async function importCleaners(queueMode: unknown, downloadMode: unknown) {
  const tx = {
    queueCleanerConfig: { upsert: vi.fn() },
    downloadCleanerConfig: { upsert: vi.fn() },
  };
  const data = {
    queueConfig: { enabled: true, intervalMinutes: 30, autoRunMode: queueMode },
    downloadConfig: { enabled: true, intervalMinutes: 60, autoRunMode: downloadMode },
  } as unknown as ExportedCleanup;
  await applyCleanupInTxn(tx as unknown as Prisma.TransactionClient, data, []);
  const stored = (upsert: ReturnType<typeof vi.fn>) => {
    const { create, update } = upsert.mock.calls[0][0];
    expect(create.autoRunMode).toBe(update.autoRunMode);
    return update.autoRunMode;
  };
  return [stored(tx.queueCleanerConfig.upsert), stored(tx.downloadCleanerConfig.upsert)];
}

describe('settings import: cleaner auto-run mode', () => {
  it('keeps a known mode', async () => {
    expect(await importCleaners('enabled', 'dryRun')).toEqual(['enabled', 'dryRun']);
  });

  it('stores an unknown or missing mode as disabled', async () => {
    expect(await importCleaners('ENABLED', 42)).toEqual(['disabled', 'disabled']);
    expect(await importCleaners(undefined, 'auto')).toEqual(['disabled', 'disabled']);
  });
});

describe('settings import: Queue Cleaner app switches', () => {
  it('keeps an app turned off, and turns on apps an older export does not name', async () => {
    const tx = { queueCleanerConfig: { upsert: vi.fn() }, downloadCleanerConfig: { upsert: vi.fn() } };
    const data = {
      queueConfig: { enabled: true, intervalMinutes: 30, includeSonarr: false, includeRadarr: true },
      downloadConfig: { enabled: true, intervalMinutes: 60 },
    } as unknown as ExportedCleanup;
    await applyCleanupInTxn(tx as unknown as Prisma.TransactionClient, data, []);
    const { create, update } = tx.queueCleanerConfig.upsert.mock.calls[0][0];
    for (const stored of [create, update]) {
      expect(stored).toMatchObject({ includeSonarr: false, includeRadarr: true, includeLidarr: true });
    }
  });
});
