import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    twitchMediaFile: { findUnique: vi.fn() },
    twitchJob: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
  return { tx, findMany: vi.fn(), aggregate: vi.fn(), $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)) };
});

vi.mock('@/lib/db', () => ({ prisma: { $transaction: mocks.$transaction, twitchMediaFile: { findMany: mocks.findMany, aggregate: mocks.aggregate } } }));

import { buildFileWhere, listFiles, requestOriginalJob, requestReencode, serializeFile, typicalSavingPercent, type FileRow } from './files';
import { REENCODE_NOW_PRIORITY } from './reencode-window';

const actor = { id: 'u', username: 'sai' };
const { tx } = mocks;

const row = {
  id: 'f',
  videoId: 'v',
  relativePath: 'secret/path/x.mkv',
  sidecars: ['secret/path/x.chat.json.gz', 'secret/path/x-thumb.jpg'],
  sizeBytes: BigInt(100),
  durationSeconds: 60,
  videoCodec: 'hevc',
  height: 1080,
  reencodedAt: new Date(),
  reencodeQuality: 20,
  reencodeSkippedAt: null,
  reencodeSkippedBytes: null,
  originalRelativePath: '.originals/secret/path/x.mkv',
  originalDeleteAfter: new Date(),
  originalDeletedAt: null,
  originalSizeBytes: BigInt(300),
  originalVideoCodec: 'h264',
  keepForever: false,
  jellyfinItemId: null,
  createdAt: new Date(),
  video: {
    id: 'v',
    twitchVideoId: '100',
    type: 'ARCHIVE',
    title: 'A stream',
    thumbnailUrl: null,
    twitchCreatedAt: new Date(),
    streamer: { id: 's', displayName: 'Gigguk', profileImageUrl: null },
  },
  jobs: [],
} as unknown as FileRow;

describe('serializeFile', () => {
  it('never lets a path out, and keeps what the page needs from them', () => {
    const file = serializeFile(row);
    expect(JSON.stringify(file)).not.toContain('secret');
    expect(file).toMatchObject({ originalKept: true, chatArchived: true, sizeBytes: 100, originalSizeBytes: 300 });
  });
});

describe('buildFileWhere', () => {
  it('ignores a filter it does not know', () => {
    expect(buildFileWhere(new URLSearchParams('filter=nonsense'))).toEqual({ AND: [] });
  });

  it('finds kept originals', () => {
    expect(buildFileWhere(new URLSearchParams('filter=original-kept'))).toEqual({ AND: [{ originalRelativePath: { not: null } }] });
  });
});

describe('listFiles sorted by most saved', () => {
  const size = (id: string, saved: number) => ({ id, reencodedAt: saved ? new Date() : null, sizeBytes: BigInt(100), originalSizeBytes: BigInt(100 + saved) });

  it('puts the biggest saving first and keeps ties in a fixed order across pages', async () => {
    mocks.findMany.mockImplementation(async (query: { where: { id?: { in: string[] } } }) => (
      query.where.id ? query.where.id.in.map((id) => ({ id })) : [size('c', 0), size('a', 0), size('z', 50), size('b', 0)]
    ));

    const first = await listFiles({}, 'saved', 0, 2);
    const second = await listFiles({}, 'saved', 2, 2);

    expect([...first, ...second].map((file) => file.id)).toEqual(['z', 'a', 'b', 'c']);
  });
});

describe('typicalSavingPercent', () => {
  it('is what was really saved, across every re-encoded file', async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { sizeBytes: BigInt(73), originalSizeBytes: BigInt(100) } });
    expect(await typicalSavingPercent()).toBe(27);
  });

  it('promises nothing before there is a result', async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { sizeBytes: null, originalSizeBytes: null } });
    expect(await typicalSavingPercent()).toBeNull();
  });
});

describe('requestReencode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.twitchMediaFile.findUnique.mockResolvedValue({ videoId: 'v', reencodedAt: null, videoCodec: 'h264' });
    tx.twitchJob.findFirst.mockResolvedValue(null);
  });

  it('takes the per-file lock before it checks anything', async () => {
    await requestReencode('f', 'now', actor);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.twitchMediaFile.findUnique.mock.invocationCallOrder[0]);
  });

  it('queues a job the night window will not hold back', async () => {
    expect(await requestReencode('f', 'now', actor)).toBe('queued');
    expect(tx.twitchJob.create.mock.calls[0][0].data).toMatchObject({ kind: 'REENCODE', priority: REENCODE_NOW_PRIORITY, mediaFileId: 'f' });
  });

  it('leaves a tonight job to the night window', async () => {
    await requestReencode('f', 'tonight', actor);
    expect(tx.twitchJob.create.mock.calls[0][0].data.priority).toBe(0);
  });

  it('moves a waiting re-encode rather than adding a second', async () => {
    tx.twitchJob.findFirst.mockResolvedValueOnce({ id: 'j', kind: 'REENCODE', state: 'QUEUED' });
    expect(await requestReencode('f', 'now', actor)).toBe('queued');
    expect(tx.twitchJob.create).not.toHaveBeenCalled();
    expect(tx.twitchJob.update.mock.calls[0][0].data.priority).toBe(REENCODE_NOW_PRIORITY);
  });

  it('leaves a running re-encode alone', async () => {
    tx.twitchJob.findFirst.mockResolvedValueOnce({ id: 'j', kind: 'REENCODE', state: 'RUNNING' });
    expect(await requestReencode('f', 'now', actor)).toBe('queued');
    expect(tx.twitchJob.update).not.toHaveBeenCalled();
  });

  it.each([
    ['already re-encoded', { videoId: 'v', reencodedAt: new Date(), videoCodec: 'hevc' }],
    ['HEVC from the start', { videoId: 'v', reencodedAt: null, videoCodec: 'hevc' }],
  ])('has nothing to do for a file %s', async (_name, file) => {
    tx.twitchMediaFile.findUnique.mockResolvedValue(file);
    expect(await requestReencode('f', 'now', actor)).toBe('nothing-to-do');
  });

  it('refuses while another job is on the file', async () => {
    tx.twitchJob.findFirst.mockResolvedValueOnce({ id: 'j', kind: 'DELETE_FILES', state: 'QUEUED' });
    expect(await requestReencode('f', 'now', actor)).toBe('busy');
    expect(tx.twitchJob.create).not.toHaveBeenCalled();
  });

  it('refuses while the video is being downloaded again', async () => {
    tx.twitchJob.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'download' });
    expect(await requestReencode('f', 'now', actor)).toBe('busy');
  });

  it('reports a file that is gone', async () => {
    tx.twitchMediaFile.findUnique.mockResolvedValue(null);
    expect(await requestReencode('f', 'now', actor)).toBe('missing');
  });
});

describe('requestOriginalJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.twitchMediaFile.findUnique.mockResolvedValue({ videoId: 'v', originalRelativePath: '.originals/x.mkv' });
    tx.twitchJob.findFirst.mockResolvedValue(null);
  });

  it('ties the job to the re-encode it is about', async () => {
    const reencodedAt = new Date('2026-10-30T02:00:00.000Z');
    tx.twitchMediaFile.findUnique.mockResolvedValue({ videoId: 'v', reencodedAt, originalRelativePath: '.originals/x.mkv' });
    await requestOriginalJob('f', 'RESTORE_ORIGINAL', actor);
    expect(tx.twitchJob.create.mock.calls[0][0].data.options).toEqual({ generation: reencodedAt.toISOString() });
  });

  it('queues the job against the file, with the person who asked', async () => {
    expect(await requestOriginalJob('f', 'RESTORE_ORIGINAL', actor)).toBe('queued');
    expect(tx.twitchJob.create.mock.calls[0][0].data).toMatchObject({
      kind: 'RESTORE_ORIGINAL', mediaFileId: 'f', videoId: 'v', requestedByUsername: 'sai',
    });
  });

  it('has nothing to do once the original has gone', async () => {
    tx.twitchMediaFile.findUnique.mockResolvedValue({ videoId: 'v', originalRelativePath: null });
    expect(await requestOriginalJob('f', 'DELETE_ORIGINAL', actor)).toBe('nothing-to-do');
  });

  it('refuses while another job is on the file', async () => {
    tx.twitchJob.findFirst.mockResolvedValueOnce({ id: 'j' });
    expect(await requestOriginalJob('f', 'DELETE_ORIGINAL', actor)).toBe('busy');
    expect(tx.twitchJob.create).not.toHaveBeenCalled();
  });
});
