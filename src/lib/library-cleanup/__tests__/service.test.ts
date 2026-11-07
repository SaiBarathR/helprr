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
  sessions: vi.fn(),
  deletedIds: new Set<number>(),
  movieExtra: (() => ({})) as (id: number) => Record<string, unknown>,
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
        const before = mocks.rows.length;
        mocks.rows = mocks.rows.filter((row) => row.id !== where.id);
        return { count: before - mocks.rows.length };
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const created = await mocks.create(args);
        mocks.rows.push(created);
        return created;
      }),
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
  getJellyfinClientContext: vi.fn(async () => ({ client: { getSessions: mocks.sessions } })),
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
  LeavingSoonClaimedError,
  processingMediaType,
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
    latestRequestAt: null, requestedBy: [], requesterUserIds: [], downloading: false, jellyfinIds: [`jf-${arrId}`], ...overrides,
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

function notFound() {
  return new AxiosError('nf', '404', undefined, undefined,
    { status: 404, data: {}, statusText: 'Not Found', headers: {}, config: { headers: new AxiosHeaders() } });
}

function gathers(titles: TitleFacts[], keepTagIds: Array<[string, number | null]> = [['radarr-1', 4]]) {
  mocks.gather.mockResolvedValue({ titles, keepTagIds: new Map(keepTagIds), seerrConnected: true, warnings: [] });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows = [row(1), row(2), row(3, 5)];
  gathers([facts(1), facts(2), facts(3)]);
  // Radarr as a little state machine: a deleted movie answers 404 afterwards.
  mocks.deletedIds = new Set();
  mocks.movieExtra = () => ({});
  mocks.radarr.deleteMovie.mockImplementation(async (id: number) => { mocks.deletedIds.add(id); });
  mocks.radarr.getMovieById.mockImplementation(async (id: number) => {
    if (mocks.deletedIds.has(id)) throw notFound();
    return { id, tmdbId: id, tags: [], ...mocks.movieExtra(id) };
  });
  mocks.sessions.mockResolvedValue([]);
  mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `new-${data.arrId}`, ...data }));
});

describe('library deletion', () => {
  it('previews only due titles and reports protected ones', async () => {
    gathers([facts(1), facts(2, { lastWatchedAt: new Date(NOW - DAY) })]);
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
    gathers([facts(1), facts(2, change), facts(3)]);
    await expect(executeLibraryDeletion(binding, 'p', admin, NOW)).rejects.toBeInstanceOf(StaleCleanupPreviewError);
    expect(mocks.radarr.deleteMovie).not.toHaveBeenCalled();
  });

  it('is stale when the import-list choice differs from the preview', async () => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    const tampered = { ...binding, candidates: binding.candidates.map((c) => ({ ...c, addImportListExclusion: true })) };
    await expect(executeLibraryDeletion(tampered, 'p', admin, NOW)).rejects.toBeInstanceOf(StaleCleanupPreviewError);
    expect(mocks.radarr.deleteMovie).not.toHaveBeenCalled();
  });

  it('skips a title someone kept during the run (Keep claimed it first)', async () => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    mocks.radarr.deleteMovie.mockImplementationOnce(async (id: number) => {
      mocks.deletedIds.add(id);
      // Keep on title 2 lands while title 1 is being deleted.
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
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result).toMatchObject({ deleted: 1, failed: 1 });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ targetId: 1, success: false, errorMessage: '500 from Radarr' }));
    expect(mocks.history.mock.calls[0][0].data).toMatchObject({ action: 'failed', outcomeStatus: 'failed', errorMessage: '500 from Radarr' });
    expect(mocks.rows.some((r) => r.id === 'ls-1')).toBe(true);
  });

  it('does not claim a title gone after a FAILED call as removed by Helprr', async () => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    mocks.radarr.deleteMovie.mockRejectedValueOnce(new Error('socket hang up'));
    // The last look before the call finds it; the check after the failed call does not.
    mocks.radarr.getMovieById.mockResolvedValueOnce({ id: 1, tmdbId: 1, tags: [] }).mockRejectedValueOnce(notFound());
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result).toMatchObject({ deleted: 1, failed: 0, skipped: 1 });
    expect(result.results[0]).toMatchObject({ outcome: 'skipped', message: 'Gone after a failed delete call; not confirmed as removed by Helprr' });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ targetId: 1, success: false, details: expect.objectContaining({ after: 'absent' }) }));
    expect(mocks.history.mock.calls[0][0].data).toMatchObject({ action: 'skipped', filesDeleted: false, reason: 'Gone after a failed delete call; not confirmed as removed by Helprr' });
    expect(mocks.rows.some((r) => r.id === 'ls-1')).toBe(false);
  });

  it.each<[string, () => void, string]>([
    ['the arr still lists it', () => mocks.radarr.deleteMovie.mockImplementationOnce(async () => {}), 'Sonarr/Radarr accepted the delete but still lists the title'],
    ['the check afterwards fails', () => mocks.radarr.getMovieById
      .mockResolvedValueOnce({ id: 1, tmdbId: 1, tags: [] }).mockRejectedValueOnce(new Error('timeout')), 'Could not confirm the title is gone'],
  ])('records success only once the title is confirmed gone: %s', async (_name, arrange, message) => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    arrange();
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result.results[0]).toMatchObject({ outcome: 'failed', message });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ targetId: 1, success: false, errorMessage: message }));
    expect(mocks.history.mock.calls[0][0].data).toMatchObject({ action: 'failed', outcomeStatus: 'failed' });
    expect(mocks.rows.some((r) => r.id === 'ls-1')).toBe(true);
  });

  it.each<[string, unknown[]]>([
    ['by Jellyfin item id', [{ NowPlayingItem: { Id: 'jf-1', Type: 'Movie' } }]],
    ['by provider id', [{ NowPlayingItem: { Id: 'other-copy', Type: 'Movie', ProviderIds: { Tmdb: '1' } } }]],
  ])('skips and puts back a title someone is playing right now (%s)', async (_name, sessions) => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    mocks.sessions.mockResolvedValue(sessions);
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result).toMatchObject({ deleted: 1, skipped: 1 });
    expect(mocks.radarr.deleteMovie).not.toHaveBeenCalledWith(1, true, false);
    expect(mocks.rows.some((r) => r.id === 'ls-1')).toBe(true);
  });

  it('skips and puts back every title when Jellyfin sessions cannot be read', async () => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    mocks.sessions.mockRejectedValue(new Error('Jellyfin down'));
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result).toMatchObject({ deleted: 0, skipped: 2 });
    expect(mocks.radarr.deleteMovie).not.toHaveBeenCalled();
    expect(mocks.rows.map((r) => r.id).sort()).toEqual(['ls-1', 'ls-2', 'ls-3']);
  });

  describe('without Seerr connected', () => {
    const WARNING = "Seerr isn't connected, so requests made in Seerr were not checked. Requests made in Helprr still count.";
    const withoutSeerr = (titles: TitleFacts[]) => mocks.gather.mockResolvedValue({
      titles, keepTagIds: new Map([['radarr-1', 4]]), seerrConnected: false, warnings: [WARNING],
    });

    it('runs Delete now, says requests in Seerr were not checked, and still honours Helprr requests', async () => {
      // Movie 2 has an open request made in Helprr.
      withoutSeerr([facts(1), facts(2, { openRequest: true }), facts(3)]);
      const preview = await previewLibraryDeletion(false, NOW);
      expect(preview).toMatchObject({ seerrChecked: false, warnings: [WARNING], readyCount: 1 });
      expect(preview.items.find((i) => i.id === 'ls-2')?.status).toBe('protected');

      const result = await executeLibraryDeletion(preview.binding, 'p', admin, NOW);
      expect(result).toMatchObject({ deleted: 1, seerrChecked: false, warnings: [WARNING] });
      expect(mocks.radarr.deleteMovie).toHaveBeenCalledExactlyOnceWith(1, true, false);
      expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ seerrChecked: false }) }));
    });

    it('is stale when Seerr was connected or removed between the preview and the run', async () => {
      withoutSeerr([facts(1), facts(2), facts(3)]);
      const unchecked = await previewLibraryDeletion(false, NOW);
      gathers([facts(1), facts(2), facts(3)]);
      await expect(executeLibraryDeletion(unchecked.binding, 'p', admin, NOW)).rejects.toBeInstanceOf(StaleCleanupPreviewError);

      const checked = await previewLibraryDeletion(false, NOW);
      withoutSeerr([facts(1), facts(2), facts(3)]);
      await expect(executeLibraryDeletion(checked.binding, 'p', admin, NOW)).rejects.toBeInstanceOf(StaleCleanupPreviewError);
      expect(mocks.radarr.deleteMovie).not.toHaveBeenCalled();
    });

    it('still lets the admin mark titles', async () => {
      withoutSeerr([facts(1), facts(2)]);
      mocks.rows = [];
      const marked = await markLeavingSoon(admin, 'movie', ['RADARR:radarr-1:1'], NOW);
      expect(marked.marked).toHaveLength(1);
    });
  });

  it('marks a title as being processed while its delete runs, so Keep can say so', async () => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    let during: string | undefined;
    let keepError: unknown;
    mocks.radarr.deleteMovie.mockImplementationOnce(async (id: number) => {
      during = processingMediaType('ls-1');
      keepError = await keepLeavingSoonItem(row(1) as never, admin).catch((e) => e);
      mocks.deletedIds.add(id);
    });
    await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(during).toBe('movie');
    expect(keepError).toBeInstanceOf(LeavingSoonClaimedError);
    expect((keepError as Error).message).toBe('Being processed, try again in a moment.');
    expect(processingMediaType('ls-1')).toBeUndefined();
  });

  it('clears titles already gone from the arr without calling delete', async () => {
    gathers([facts(1)]);
    const { binding, items } = await previewLibraryDeletion(false, NOW);
    expect(items.find((i) => i.id === 'ls-2')?.status).toBe('gone');
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result).toMatchObject({ deleted: 1, skipped: 1 });
    expect(mocks.radarr.deleteMovie).toHaveBeenCalledTimes(1);
    expect(mocks.rows.map((r) => r.id)).toEqual(['ls-3']);
  });

  it('never deletes a title whose id now belongs to another title, or whose instance is gone', async () => {
    gathers([facts(1, { tmdbId: 999, title: 'Other Movie' }), facts(2)], [['radarr-1', 4]]);
    let preview = await previewLibraryDeletion(false, NOW);
    expect(preview.items.find((i) => i.id === 'ls-1')).toMatchObject({ status: 'protected', title: 'Other Movie' });
    gathers([], []);
    preview = await previewLibraryDeletion(false, NOW);
    expect(preview.items.map((i) => i.status)).toEqual(['protected', 'protected']);
    expect(preview.items[0].exclusions[0]).toMatch(/no longer connected/);
  });

  it('protects a title watched during its countdown, even when "not watched in" is shorter', async () => {
    mocks.rows = [{ ...row(1), markedAt: new Date(NOW - 14 * DAY) }];
    vi.mocked((await import('../config')).loadLibraryCleanupSettings).mockResolvedValueOnce({
      ...DEFAULT_LIBRARY_CLEANUP_SETTINGS, movieRule: { ...DEFAULT_LIBRARY_CLEANUP_SETTINGS.movieRule, unwatchedDays: 7 },
    });
    gathers([facts(1, { lastWatchedAt: new Date(NOW - 12 * DAY) })]);
    const preview = await previewLibraryDeletion(false, NOW);
    expect(preview.items[0]).toMatchObject({ status: 'protected', exclusions: ['Watched recently'] });
  });

  it('stops at the last look: a keep tag added in the arr since the run started', async () => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    mocks.movieExtra = (id) => (id === 2 ? { tags: [4] } : {});
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result).toMatchObject({ deleted: 1, skipped: 1 });
    expect(mocks.radarr.deleteMovie).toHaveBeenCalledTimes(1);
    expect(mocks.radarr.deleteMovie).toHaveBeenCalledWith(1, true, false);
  });

  it('stops at the last look: a keep tag created and applied in the arr during the run', async () => {
    gathers([facts(1), facts(2), facts(3)], [['radarr-1', null]]);
    const { binding } = await previewLibraryDeletion(false, NOW);
    mocks.radarr.getTags.mockResolvedValue([{ id: 8, label: 'keep' }]);
    mocks.movieExtra = (id) => (id === 1 ? { tags: [8] } : {});
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result).toMatchObject({ deleted: 1, skipped: 1 });
    expect(mocks.radarr.deleteMovie).toHaveBeenCalledWith(2, true, false);
  });

  it('stops at the last look: a different title under the id puts the title back', async () => {
    const { binding } = await previewLibraryDeletion(false, NOW);
    mocks.movieExtra = (id) => (id === 2 ? { tmdbId: 555 } : {});
    const result = await executeLibraryDeletion(binding, 'p', admin, NOW);
    expect(result).toMatchObject({ deleted: 1, skipped: 1 });
    expect(mocks.rows.some((r) => r.id === 'ls-2')).toBe(true);
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
    gathers([facts(1, { requestedBy: ['Ana'], requesterUserIds: ['member-1'] }), facts(2, { keepTagged: true })]);
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

  it('refuses while Delete now holds the title', async () => {
    mocks.rows = [];
    await expect(keepLeavingSoonItem(row(1) as never, admin)).rejects.toBeInstanceOf(LeavingSoonClaimedError);
    expect(mocks.radarr.movieEditor).not.toHaveBeenCalled();
  });

  it('leaves the title listed when the arr refuses the tag', async () => {
    mocks.radarr.getTags.mockResolvedValue([{ id: 4, label: 'keep' }]);
    mocks.radarr.movieEditor.mockRejectedValue(new Error('Radarr down'));
    await expect(keepLeavingSoonItem(row(1) as never, admin)).rejects.toThrow('Radarr down');
    // Audited as a failed Keep, and the title is back on the list.
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'KEEP_MEDIA', success: false }));
    expect(processingMediaType('ls-1')).toBeUndefined();
    expect(mocks.rows.some((r) => r.id === 'ls-1')).toBe(true);
  });
});
