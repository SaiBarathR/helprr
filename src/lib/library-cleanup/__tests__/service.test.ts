import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import type { TitleFacts } from '../evaluate';
import { DEFAULT_LIBRARY_CLEANUP_SETTINGS } from '../config';

const mocks = vi.hoisted(() => ({
  gather: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  history: vi.fn(),
  audit: vi.fn(),
  notify: vi.fn(),
  radarr: { deleteMovie: vi.fn(), getMovieById: vi.fn(), getTags: vi.fn(), createTag: vi.fn(), movieEditor: vi.fn() },
  sonarr: { deleteSeries: vi.fn(), getSeriesById: vi.fn() },
  users: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../inputs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../inputs')>()),
  gatherLibraryFacts: mocks.gather,
}));
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  loadLibraryCleanupSettings: vi.fn(async () => DEFAULT_LIBRARY_CLEANUP_SETTINGS),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    leavingSoonItem: {
      findMany: vi.fn(async ({ where }: { where?: { deleteAfter?: { lte: Date }; mediaType?: string } }) => mocks.rows.filter((row) =>
        (!where?.deleteAfter || (row.deleteAfter as Date) <= where.deleteAfter.lte)
        && (!where?.mediaType || row.mediaType === where.mediaType))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => mocks.rows.find((row) => row.id === where.id) ?? null),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        mocks.rows = mocks.rows.filter((row) => row.id !== where.id);
        return { count: 1 };
      }),
      create: mocks.create,
    },
    cleanupHistory: { create: mocks.history },
    user: { findMany: mocks.users },
  },
}));
vi.mock('@/lib/file-audit', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/file-audit')>();
  return {
    ...real,
    recordOperationAudit: mocks.audit,
    runWithOperationAudit: async (input: Record<string, unknown>, op: () => Promise<unknown>) => {
      try {
        const out = await op();
        await mocks.audit({ ...input, success: true });
        return out;
      } catch (error) {
        await mocks.audit({ ...input, success: false });
        throw error;
      }
    },
  };
});
vi.mock('@/lib/service-helpers', () => ({
  getRadarrClient: vi.fn(async () => mocks.radarr),
  getSonarrClient: vi.fn(async () => mocks.sonarr),
}));
vi.mock('@/lib/cleanup/binding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cleanup/binding')>()),
  cleanupScopeFingerprint: vi.fn(async () => 'scope'),
}));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateTaggedLibrary: vi.fn() }));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: mocks.notify }));

import {
  executeLibraryDeletion,
  keepLeavingSoonItem,
  markLeavingSoon,
  previewLibraryDeletion,
  withLibraryDeletionLock,
  LibraryDeletionBusyError,
} from '../service';
import { LibraryCleanupUnavailableError } from '../inputs';
import { StaleCleanupPreviewError } from '@/lib/cleanup/binding';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-07T12:00:00Z');
const admin = { id: 'admin-1', username: 'admin' };

function facts(arrId: number, overrides: Partial<TitleFacts> = {}): TitleFacts {
  return {
    mediaType: 'movie', service: 'RADARR', instanceId: 'radarr-1', instanceLabel: 'Radarr', arrId,
    title: `Movie ${arrId}`, year: 2001, tmdbId: arrId, tvdbId: null, imdbId: null, posterUrl: null,
    sizeBytes: 4e9, added: new Date(NOW - 400 * DAY).toISOString(), rating: null, keepTagged: false,
    inJellyfin: true, lastWatchedAt: null, watchedWithoutDate: false, watchlistUserIds: [], openRequest: false,
    latestRequestAt: null, requestedBy: [], requesterUserIds: [], downloading: false, ...overrides,
  };
}

function row(arrId: number, dueInDays = -1) {
  return {
    id: `ls-${arrId}`, mediaType: 'movie', service: 'RADARR', instanceId: 'radarr-1', arrId, title: `Movie ${arrId}`,
    year: 2001, tmdbId: arrId, tvdbId: null, imdbId: null, posterUrl: null, sizeBytes: BigInt(4e9), lastWatchedAt: null,
    reasons: ['Added 400 days ago', 'Never watched'], requestedBy: [], markedByUserId: 'admin-1', markedByUsername: 'admin',
    markedAt: new Date(NOW - 20 * DAY), deleteAfter: new Date(NOW + dueInDays * DAY),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [row(1), row(2), row(3, 5)];
  mocks.gather.mockResolvedValue({ titles: [facts(1), facts(2), facts(3)], warnings: [] });
  mocks.radarr.deleteMovie.mockResolvedValue(undefined);
});

describe('library deletion', () => {
  it('previews only due titles and reports protected ones', async () => {
    mocks.gather.mockResolvedValue({ titles: [facts(1), facts(2, { lastWatchedAt: new Date(NOW - DAY) })], warnings: [] });
    const preview = await previewLibraryDeletion(false, NOW);
    expect(preview.items.map((i) => [i.id, i.status])).toEqual([['ls-1', 'ready'], ['ls-2', 'protected']]);
    expect(preview.readyCount).toBe(1);
    expect(preview.binding.cleaner).toBe('library');
  });

  it('deletes each ready title with files and writes one history row and one audit row per title', async () => {
    const { binding } = await previewLibraryDeletion(true, NOW);
    const result = await executeLibraryDeletion(binding, 'preview-1', admin, NOW);
    expect(result).toMatchObject({ deleted: 2, failed: 0, skipped: 0 });
    expect(mocks.radarr.deleteMovie).toHaveBeenCalledWith(1, true, true);
    expect(mocks.radarr.deleteMovie).toHaveBeenCalledWith(2, true, true);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'DELETE_MEDIA', service: 'RADARR', instanceId: 'radarr-1', targetId: 1, filesDeleted: true, success: true,
      user: admin, details: expect.objectContaining({ source: 'library-cleanup', previewId: 'preview-1', addImportListExclusion: true }),
    }));
    expect(mocks.history).toHaveBeenCalledTimes(2);
    expect(mocks.history.mock.calls[0][0].data).toMatchObject({
      cleaner: 'library', action: 'removedFromLibrary', filesDeleted: true, previewId: 'preview-1',
      outcomeStatus: 'succeeded', actorUserId: 'admin-1', torrentName: 'Movie 1',
    });
    // The not-yet-due title is untouched and still listed.
    expect(mocks.rows.map((r) => r.id)).toEqual(['ls-3']);
  });

  it('deletes nothing when a source cannot be read at execute time', async () => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    mocks.gather.mockRejectedValue(new LibraryCleanupUnavailableError('Jellyfin could not be read. Nothing was changed.'));
    await expect(executeLibraryDeletion(binding, 'p', admin, NOW)).rejects.toBeInstanceOf(LibraryCleanupUnavailableError);
    expect(mocks.radarr.deleteMovie).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<TitleFacts>]>([
    ['watched since the preview', { lastWatchedAt: new Date(NOW - DAY) }],
    ['kept (tag added in the arr)', { keepTagged: true }],
    ['put on a watchlist', { watchlistUserIds: ['u1'] }],
    ['requested', { openRequest: true }],
    ['downloading', { downloading: true }],
  ])('is stale and deletes nothing when a title was %s', async (_name, change) => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    mocks.gather.mockResolvedValue({ titles: [facts(1), facts(2, change), facts(3)], warnings: [] });
    await expect(executeLibraryDeletion(binding, 'p', admin, NOW)).rejects.toBeInstanceOf(StaleCleanupPreviewError);
    expect(mocks.radarr.deleteMovie).not.toHaveBeenCalled();
  });

  it('is stale when the import-list choice differs from the preview', async () => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    const tampered = { ...binding, candidates: binding.candidates.map((c) => ({ ...c, addImportListExclusion: true })) };
    await expect(executeLibraryDeletion(tampered, 'p', admin, NOW)).rejects.toBeInstanceOf(StaleCleanupPreviewError);
    expect(mocks.radarr.deleteMovie).not.toHaveBeenCalled();
  });

  it('skips a title someone kept during the run', async () => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    mocks.radarr.deleteMovie.mockImplementationOnce(async () => {
      mocks.rows = mocks.rows.filter((r) => r.id !== 'ls-2');
    });
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result).toMatchObject({ deleted: 1, skipped: 1 });
    expect(mocks.radarr.deleteMovie).toHaveBeenCalledTimes(1);
    expect(mocks.history.mock.calls[1][0].data).toMatchObject({ action: 'skipped', outcomeStatus: 'skipped' });
  });

  it('records a failed delete truthfully and keeps the title listed', async () => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    mocks.radarr.deleteMovie.mockRejectedValueOnce(new Error('500 from Radarr'));
    mocks.radarr.getMovieById.mockResolvedValue({ id: 1 });
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result).toMatchObject({ deleted: 1, failed: 1 });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ targetId: 1, success: false, errorMessage: '500 from Radarr' }));
    expect(mocks.history.mock.calls[0][0].data).toMatchObject({ action: 'failed', outcomeStatus: 'failed', errorMessage: '500 from Radarr' });
    expect(mocks.rows.some((r) => r.id === 'ls-1')).toBe(true);
  });

  it('counts a failed call as deleted when the arr no longer has the title', async () => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    mocks.radarr.deleteMovie.mockRejectedValueOnce(new Error('socket hang up'));
    mocks.radarr.getMovieById.mockRejectedValue(new AxiosError('nf', '404', undefined, undefined,
      { status: 404, data: {}, statusText: 'Not Found', headers: {}, config: { headers: new AxiosHeaders() } }));
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result).toMatchObject({ deleted: 2, failed: 0 });
  });

  it('clears titles already gone from the arr without calling delete', async () => {
    mocks.gather.mockResolvedValue({ titles: [facts(1)], warnings: [] });
    const { binding, items } = await previewLibraryDeletion(false, NOW);
    expect(items.find((i) => i.id === 'ls-2')?.status).toBe('gone');
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result).toMatchObject({ deleted: 1, skipped: 1 });
    expect(mocks.radarr.deleteMovie).toHaveBeenCalledTimes(1);
    expect(mocks.rows.map((r) => r.id)).toEqual(['ls-3']);
  });

  it('runs one deletion at a time', async () => {
    let release!: () => void;
    const first = withLibraryDeletionLock(() => new Promise<void>((resolve) => { release = resolve; }));
    await expect(withLibraryDeletionLock(async () => 'second')).rejects.toBeInstanceOf(LibraryDeletionBusyError);
    release();
    await first;
    await expect(withLibraryDeletionLock(async () => 'third')).resolves.toBe('third');
  });
});

describe('mark Leaving soon', () => {
  it('re-evaluates each title and only marks those that still qualify', async () => {
    mocks.rows = [];
    mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `new-${data.arrId}`, ...data }));
    mocks.gather.mockResolvedValue({
      titles: [facts(1, { requestedBy: ['Ana'], requesterUserIds: ['member-1'] }), facts(2, { keepTagged: true })],
      warnings: [],
    });
    mocks.users.mockResolvedValue([{ id: 'member-1', role: 'member', template: 'member', permissions: {}, status: 'active' }]);
    const result = await markLeavingSoon(admin, 'movie', ['RADARR:radarr-1:1', 'RADARR:radarr-1:2', 'RADARR:radarr-1:9'], NOW);
    expect(result.marked.map((m) => m.key)).toEqual(['RADARR:radarr-1:1']);
    expect(result.marked[0].deleteAfter).toBe(new Date(NOW + 14 * DAY).toISOString());
    expect(result.skipped).toEqual([
      { key: 'RADARR:radarr-1:2', title: 'Movie 2', reason: 'Tagged "keep"' },
      { key: 'RADARR:radarr-1:9', title: null, reason: 'No longer in the library' },
    ]);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'leavingSoon', userIds: ['member-1'], ownerUserId: 'member-1', url: '/movies/1?instance=radarr-1',
    }));
  });
});

describe('keep', () => {
  it('adds the existing keep tag, audits it, and takes the title off the list', async () => {
    mocks.radarr.getTags.mockResolvedValue([{ id: 4, label: 'Keep' }]);
    await keepLeavingSoonItem(row(1) as never, { id: 'member-1', username: 'mia' });
    expect(mocks.radarr.createTag).not.toHaveBeenCalled();
    expect(mocks.radarr.movieEditor).toHaveBeenCalledWith({ movieIds: [1], tags: [4], applyTags: 'add' });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'KEEP_MEDIA', targetId: 1, instanceId: 'radarr-1', success: true, user: { id: 'member-1', username: 'mia' },
    }));
    expect(mocks.rows.some((r) => r.id === 'ls-1')).toBe(false);
  });

  it('creates the tag when missing', async () => {
    mocks.radarr.getTags.mockResolvedValue([]);
    mocks.radarr.createTag.mockResolvedValue({ id: 9, label: 'keep' });
    await keepLeavingSoonItem(row(1) as never, admin);
    expect(mocks.radarr.createTag).toHaveBeenCalledWith('keep');
    expect(mocks.radarr.movieEditor).toHaveBeenCalledWith({ movieIds: [1], tags: [9], applyTags: 'add' });
  });

  it('leaves the title listed when the arr refuses the tag', async () => {
    mocks.radarr.getTags.mockResolvedValue([{ id: 4, label: 'keep' }]);
    mocks.radarr.movieEditor.mockRejectedValue(new Error('Radarr down'));
    await expect(keepLeavingSoonItem(row(1) as never, admin)).rejects.toThrow('Radarr down');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'KEEP_MEDIA', success: false }));
    expect(mocks.rows.some((r) => r.id === 'ls-1')).toBe(true);
  });
});
