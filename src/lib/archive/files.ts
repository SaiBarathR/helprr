import type { ArchiveJobKind, ArchivePlatform, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ACTIVE_JOB_STATES } from './jobs';
import { REENCODE_NOW_PRIORITY } from './reencode-window';
import { FILE_LOCK_TRANSACTION } from './retention';
import { sizeThumbnail } from '@/lib/twitch/serialize';

// The paths are read only to tell whether an original is there; serializeFile drops them.
export const fileSelect = (platform: ArchivePlatform) => ({
  id: true,
  videoId: true,
  relativePath: true,
  sidecars: true,
  sizeBytes: true,
  durationSeconds: true,
  videoCodec: true,
  height: true,
  reencodedAt: true,
  reencodeQuality: true,
  reencodeSkippedAt: true,
  reencodeSkippedBytes: true,
  originalRelativePath: true,
  originalDeleteAfter: true,
  originalDeletedAt: true,
  originalSizeBytes: true,
  originalVideoCodec: true,
  keepForever: true,
  jellyfinItemId: true,
  createdAt: true,
  video: {
    select: {
      id: true,
      externalId: true,
      type: true,
      title: true,
      thumbnailUrl: true,
      sourceCreatedAt: true,
      creator: { select: { id: true, displayName: true, profileImageUrl: true } },
    },
  },
  jobs: {
    where: { platform, state: { in: ACTIVE_JOB_STATES } },
    select: { id: true, kind: true, state: true, stage: true, progress: true, priority: true },
    take: 1,
  },
}) satisfies Prisma.ArchiveMediaFileSelect;

export type FileRow = Prisma.ArchiveMediaFileGetPayload<{ select: ReturnType<typeof fileSelect> }>;

const sidecarNames = (sidecars: Prisma.JsonValue): string[] => (
  Array.isArray(sidecars) ? sidecars.filter((entry): entry is string => typeof entry === 'string') : []
);

/** BigInt does not survive JSON, and a path never leaves the server. */
export function serializeFile(file: FileRow, watchedAt?: Date) {
  const sidecars = sidecarNames(file.sidecars);
  return {
    id: file.id,
    videoId: file.videoId,
    twitchVideoId: file.video.externalId,
    type: file.video.type,
    title: file.video.title,
    thumbnailUrl: sizeThumbnail(file.video.thumbnailUrl),
    streamedAt: file.video.sourceCreatedAt,
    streamer: file.video.creator,
    sizeBytes: Number(file.sizeBytes),
    durationSeconds: file.durationSeconds,
    videoCodec: file.videoCodec,
    height: file.height,
    downloadedAt: file.createdAt,
    keepForever: file.keepForever,
    jellyfinItemId: file.jellyfinItemId,
    watchedAt: watchedAt ?? null,
    chatArchived: sidecars.some((name) => name.endsWith('.chat.json.gz')),
    reencodedAt: file.reencodedAt,
    reencodeQuality: file.reencodeQuality,
    reencodeSkippedAt: file.reencodeSkippedAt,
    reencodeSkippedBytes: file.reencodeSkippedBytes === null ? null : Number(file.reencodeSkippedBytes),
    originalKept: file.originalRelativePath !== null,
    originalDeleteAfter: file.originalDeleteAfter,
    originalDeletedAt: file.originalDeletedAt,
    originalSizeBytes: file.originalSizeBytes === null ? null : Number(file.originalSizeBytes),
    originalVideoCodec: file.originalVideoCodec,
    activeJob: file.jobs[0] ?? null,
  };
}

export type LibraryFilter = 'reencoded' | 'not-reencoded' | 'original-kept' | 'keep-forever' | 'not-in-jellyfin';

const FILTERS: Record<LibraryFilter, Prisma.ArchiveMediaFileWhereInput> = {
  reencoded: { reencodedAt: { not: null } },
  'not-reencoded': { reencodedAt: null },
  'original-kept': { originalRelativePath: { not: null } },
  'keep-forever': { keepForever: true },
  'not-in-jellyfin': { jellyfinItemId: null },
};

export function buildFileWhere(params: URLSearchParams, platform: ArchivePlatform): Prisma.ArchiveMediaFileWhereInput {
  const and: Prisma.ArchiveMediaFileWhereInput[] = [{ platform }];
  const filter = FILTERS[params.get('filter') as LibraryFilter];
  if (filter) and.push(filter);
  const streamer = params.get('streamer');
  if (streamer) and.push({ video: { creatorId: streamer } });
  const q = params.get('q')?.trim().slice(0, 100);
  if (q) {
    and.push({
      OR: [
        { video: { title: { contains: q, mode: 'insensitive' } } },
        { video: { creator: { displayName: { contains: q, mode: 'insensitive' } } } },
      ],
    });
  }
  return { AND: and };
}

const ORDERS: Record<string, Prisma.ArchiveMediaFileOrderByWithRelationInput[]> = {
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
  largest: [{ sizeBytes: 'desc' }, { id: 'desc' }],
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
};

const savedBytes = (file: { reencodedAt: Date | null; sizeBytes: bigint; originalSizeBytes: bigint | null }) => (
  file.reencodedAt && file.originalSizeBytes !== null ? Number(file.originalSizeBytes - file.sizeBytes) : 0
);

/** A saving is a difference of two columns, so that sort is done here. A library is small. */
export async function listFiles(
  where: Prisma.ArchiveMediaFileWhereInput,
  platform: ArchivePlatform,
  sort: string | null,
  skip: number,
  take: number,
): Promise<FileRow[]> {
  if (sort !== 'saved') {
    return prisma.archiveMediaFile.findMany({ where, orderBy: ORDERS[sort ?? ''] ?? ORDERS.newest, skip, take, select: fileSelect(platform) });
  }
  const sizes = await prisma.archiveMediaFile.findMany({
    where,
    select: { id: true, reencodedAt: true, sizeBytes: true, originalSizeBytes: true },
  });
  // Ties are common, as every file not re-encoded saved nothing, so pages need a fixed order.
  const ids = sizes
    .sort((a, b) => savedBytes(b) - savedBytes(a) || a.id.localeCompare(b.id))
    .slice(skip, skip + take)
    .map((file) => file.id);
  const rows = await prisma.archiveMediaFile.findMany({ where: { id: { in: ids } }, select: fileSelect(platform) });
  return ids.flatMap((id) => rows.find((row) => row.id === id) ?? []);
}

export async function summarizeFiles(platform: ArchivePlatform) {
  const [files, heartbeat, waiting, freed] = await Promise.all([
    prisma.archiveMediaFile.findMany({
      where: { platform },
      select: {
        reencodedAt: true,
        sizeBytes: true,
        originalSizeBytes: true,
        originalRelativePath: true,
        video: { select: { creator: { select: { id: true, displayName: true } } } },
      },
    }),
    prisma.archiveWorkerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { diskFreeBytes: true } }),
    prisma.archiveJob.count({ where: { platform, kind: 'REENCODE', state: { in: ACTIVE_JOB_STATES } } }),
    prisma.archiveDeletedFile.aggregate({ where: { platform }, _sum: { freedBytes: true } }),
  ]);

  const streamers = new Map<string, { id: string; displayName: string; count: number; bytes: number }>();
  let totalBytes = 0;
  let saved = 0;
  let reencoded = 0;
  let originalsKept = 0;
  let originalsBytes = 0;
  for (const file of files) {
    const bytes = Number(file.sizeBytes);
    const { id, displayName } = file.video.creator;
    const entry = streamers.get(id) ?? { id, displayName, count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += bytes;
    streamers.set(id, entry);
    totalBytes += bytes;
    saved += savedBytes(file);
    if (file.reencodedAt) reencoded += 1;
    if (file.originalRelativePath) {
      originalsKept += 1;
      originalsBytes += Number(file.originalSizeBytes ?? 0);
    }
  }

  return {
    count: files.length,
    totalBytes,
    savedBytes: saved,
    reencoded,
    reencodeWaiting: waiting,
    originalsKept,
    originalsBytes,
    freedBytes: Number(freed._sum.freedBytes ?? 0),
    diskFreeBytes: heartbeat?.diskFreeBytes === null || heartbeat === null ? null : Number(heartbeat.diskFreeBytes),
    streamers: [...streamers.values()].sort((a, b) => b.bytes - a.bytes),
  };
}

/** What re-encoding has really saved here, as a percentage, or null before there is a result. */
export async function typicalSavingPercent(platform: ArchivePlatform): Promise<number | null> {
  const { _sum } = await prisma.archiveMediaFile.aggregate({
    where: { platform, reencodedAt: { not: null }, originalSizeBytes: { not: null } },
    _sum: { sizeBytes: true, originalSizeBytes: true },
  });
  const before = Number(_sum.originalSizeBytes ?? 0);
  return before > 0 ? Math.round((1 - Number(_sum.sizeBytes ?? 0) / before) * 100) : null;
}

export type FileJobResult = 'queued' | 'missing' | 'busy' | 'nothing-to-do';

interface Actor {
  id: string;
  username: string;
}

// The same lock as enqueueFileDelete, so no two requests can pass these checks together.
async function withFileLock<T>(fileId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`twitch-delete:${fileId}`}))`;
    return work(tx);
  }, FILE_LOCK_TRANSACTION);
}

const activeDownload = (tx: Prisma.TransactionClient, videoId: string) => (
  tx.archiveJob.findFirst({ where: { videoId, kind: 'DOWNLOAD', state: { in: ACTIVE_JOB_STATES } }, select: { id: true } })
);

/** `now` beats the night window. Asking for a job already waiting moves it rather than doubling it. */
export function requestReencode(fileId: string, when: 'now' | 'tonight', actor: Actor, platform: ArchivePlatform): Promise<FileJobResult> {
  const priority = when === 'now' ? REENCODE_NOW_PRIORITY : 0;
  return withFileLock(fileId, async (tx) => {
    const file = await tx.archiveMediaFile.findUnique({ where: { id: fileId, platform }, select: { videoId: true, reencodedAt: true, videoCodec: true } });
    if (!file) return 'missing';
    if (file.reencodedAt || file.videoCodec === 'hevc') return 'nothing-to-do';

    const active = await tx.archiveJob.findFirst({
      where: { mediaFileId: fileId, state: { in: ACTIVE_JOB_STATES } },
      select: { id: true, kind: true, state: true },
    });
    if (active?.kind === 'REENCODE') {
      if (active.state !== 'RUNNING') {
        await tx.archiveJob.update({ where: { id: active.id }, data: { priority, runAfter: new Date() } });
      }
      return 'queued';
    }
    if (active || await activeDownload(tx, file.videoId)) return 'busy';

    await tx.archiveJob.create({
      data: {
        platform,
        kind: 'REENCODE',
        videoId: file.videoId,
        mediaFileId: fileId,
        source: 'MANUAL',
        priority,
        requestedByUserId: actor.id,
        requestedByUsername: actor.username,
      },
    });
    return 'queued';
  });
}

/** Deleting or restoring an original. Refused while anything else is working on the file. */
export function requestOriginalJob(
  fileId: string,
  kind: Extract<ArchiveJobKind, 'DELETE_ORIGINAL' | 'RESTORE_ORIGINAL'>,
  actor: Actor,
  platform: ArchivePlatform,
): Promise<FileJobResult> {
  return withFileLock(fileId, async (tx) => {
    const file = await tx.archiveMediaFile.findUnique({ where: { id: fileId, platform }, select: { videoId: true, reencodedAt: true, originalRelativePath: true } });
    if (!file) return 'missing';
    if (!file.originalRelativePath) return 'nothing-to-do';
    const active = await tx.archiveJob.findFirst({ where: { mediaFileId: fileId, state: { in: ACTIVE_JOB_STATES } }, select: { id: true } });
    if (active || await activeDownload(tx, file.videoId)) return 'busy';

    await tx.archiveJob.create({
      data: {
        platform,
        kind,
        // The worker refuses to act once this re-encode is no longer the current one.
        options: { generation: file.reencodedAt?.toISOString() ?? null },
        videoId: file.videoId,
        mediaFileId: fileId,
        requestedByUserId: actor.id,
        requestedByUsername: actor.username,
      },
    });
    return 'queued';
  });
}

/** What happened to this video, oldest first. Job errors are left out: they can name paths. */
export async function fileTimeline(fileId: string, videoId: string, platform: ArchivePlatform) {
  const [jobs, deletions] = await Promise.all([
    prisma.archiveJob.findMany({
      where: { platform, OR: [{ mediaFileId: fileId }, { videoId, kind: 'DOWNLOAD' }] },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { id: true, kind: true, state: true, source: true, requestedByUsername: true, createdAt: true, startedAt: true, finishedAt: true },
    }),
    prisma.archiveDeletedFile.findMany({
      where: { platform, videoId, kind: 'ORIGINAL' },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, cause: true, freedBytes: true, deletedBy: true, createdAt: true },
    }),
  ]);
  return {
    jobs,
    deletions: deletions.map((row) => ({ ...row, freedBytes: Number(row.freedBytes) })),
  };
}
