import type { Prisma, TwitchJobKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ACTIVE_JOB_STATES } from './jobs';
import { REENCODE_NOW_PRIORITY } from './reencode-window';
import { sizeThumbnail } from './serialize';

// The paths are read only to tell whether an original is there; serializeFile drops them.
export const FILE_SELECT = {
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
      twitchVideoId: true,
      type: true,
      title: true,
      thumbnailUrl: true,
      twitchCreatedAt: true,
      streamer: { select: { id: true, displayName: true, profileImageUrl: true } },
    },
  },
  jobs: {
    where: { state: { in: ACTIVE_JOB_STATES } },
    select: { id: true, kind: true, state: true, stage: true, progress: true, priority: true },
    take: 1,
  },
} satisfies Prisma.TwitchMediaFileSelect;

export type FileRow = Prisma.TwitchMediaFileGetPayload<{ select: typeof FILE_SELECT }>;

const sidecarNames = (sidecars: Prisma.JsonValue): string[] => (
  Array.isArray(sidecars) ? sidecars.filter((entry): entry is string => typeof entry === 'string') : []
);

/** BigInt does not survive JSON, and a path never leaves the server. */
export function serializeFile(file: FileRow, watchedAt?: Date) {
  const sidecars = sidecarNames(file.sidecars);
  return {
    id: file.id,
    videoId: file.videoId,
    twitchVideoId: file.video.twitchVideoId,
    type: file.video.type,
    title: file.video.title,
    thumbnailUrl: sizeThumbnail(file.video.thumbnailUrl),
    streamedAt: file.video.twitchCreatedAt,
    streamer: file.video.streamer,
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

const FILTERS: Record<LibraryFilter, Prisma.TwitchMediaFileWhereInput> = {
  reencoded: { reencodedAt: { not: null } },
  'not-reencoded': { reencodedAt: null },
  'original-kept': { originalRelativePath: { not: null } },
  'keep-forever': { keepForever: true },
  'not-in-jellyfin': { jellyfinItemId: null },
};

export function buildFileWhere(params: URLSearchParams): Prisma.TwitchMediaFileWhereInput {
  const and: Prisma.TwitchMediaFileWhereInput[] = [];
  const filter = FILTERS[params.get('filter') as LibraryFilter];
  if (filter) and.push(filter);
  const streamer = params.get('streamer');
  if (streamer) and.push({ video: { streamerId: streamer } });
  const q = params.get('q')?.trim().slice(0, 100);
  if (q) {
    and.push({
      OR: [
        { video: { title: { contains: q, mode: 'insensitive' } } },
        { video: { streamer: { displayName: { contains: q, mode: 'insensitive' } } } },
      ],
    });
  }
  return { AND: and };
}

const ORDERS: Record<string, Prisma.TwitchMediaFileOrderByWithRelationInput[]> = {
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
  largest: [{ sizeBytes: 'desc' }, { id: 'desc' }],
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
};

const savedBytes = (file: { reencodedAt: Date | null; sizeBytes: bigint; originalSizeBytes: bigint | null }) => (
  file.reencodedAt && file.originalSizeBytes !== null ? Number(file.originalSizeBytes - file.sizeBytes) : 0
);

/** A saving is a difference of two columns, so that sort is done here. A library is small. */
export async function listFiles(
  where: Prisma.TwitchMediaFileWhereInput,
  sort: string | null,
  skip: number,
  take: number,
): Promise<FileRow[]> {
  if (sort !== 'saved') {
    return prisma.twitchMediaFile.findMany({ where, orderBy: ORDERS[sort ?? ''] ?? ORDERS.newest, skip, take, select: FILE_SELECT });
  }
  const sizes = await prisma.twitchMediaFile.findMany({
    where,
    select: { id: true, reencodedAt: true, sizeBytes: true, originalSizeBytes: true },
  });
  const ids = sizes.sort((a, b) => savedBytes(b) - savedBytes(a)).slice(skip, skip + take).map((file) => file.id);
  const rows = await prisma.twitchMediaFile.findMany({ where: { id: { in: ids } }, select: FILE_SELECT });
  return ids.flatMap((id) => rows.find((row) => row.id === id) ?? []);
}

export async function summarizeFiles() {
  const [files, heartbeat, waiting, freed] = await Promise.all([
    prisma.twitchMediaFile.findMany({
      select: {
        reencodedAt: true,
        sizeBytes: true,
        originalSizeBytes: true,
        originalRelativePath: true,
        video: { select: { streamer: { select: { id: true, displayName: true } } } },
      },
    }),
    prisma.twitchWorkerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { diskFreeBytes: true } }),
    prisma.twitchJob.count({ where: { kind: 'REENCODE', state: { in: ACTIVE_JOB_STATES } } }),
    prisma.twitchDeletedFile.aggregate({ _sum: { freedBytes: true } }),
  ]);

  const streamers = new Map<string, { id: string; displayName: string; count: number; bytes: number }>();
  let totalBytes = 0;
  let saved = 0;
  let reencoded = 0;
  let originalsKept = 0;
  let originalsBytes = 0;
  for (const file of files) {
    const bytes = Number(file.sizeBytes);
    const { id, displayName } = file.video.streamer;
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
  });
}

const activeDownload = (tx: Prisma.TransactionClient, videoId: string) => (
  tx.twitchJob.findFirst({ where: { videoId, kind: 'DOWNLOAD', state: { in: ACTIVE_JOB_STATES } }, select: { id: true } })
);

/** `now` beats the night window. Asking for a job already waiting moves it rather than doubling it. */
export function requestReencode(fileId: string, when: 'now' | 'tonight', actor: Actor): Promise<FileJobResult> {
  const priority = when === 'now' ? REENCODE_NOW_PRIORITY : 0;
  return withFileLock(fileId, async (tx) => {
    const file = await tx.twitchMediaFile.findUnique({ where: { id: fileId }, select: { videoId: true, reencodedAt: true, videoCodec: true } });
    if (!file) return 'missing';
    if (file.reencodedAt || file.videoCodec === 'hevc') return 'nothing-to-do';

    const active = await tx.twitchJob.findFirst({
      where: { mediaFileId: fileId, state: { in: ACTIVE_JOB_STATES } },
      select: { id: true, kind: true, state: true },
    });
    if (active?.kind === 'REENCODE') {
      if (active.state !== 'RUNNING') {
        await tx.twitchJob.update({ where: { id: active.id }, data: { priority, runAfter: new Date() } });
      }
      return 'queued';
    }
    if (active || await activeDownload(tx, file.videoId)) return 'busy';

    await tx.twitchJob.create({
      data: {
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
  kind: Extract<TwitchJobKind, 'DELETE_ORIGINAL' | 'RESTORE_ORIGINAL'>,
  actor: Actor,
): Promise<FileJobResult> {
  return withFileLock(fileId, async (tx) => {
    const file = await tx.twitchMediaFile.findUnique({ where: { id: fileId }, select: { videoId: true, originalRelativePath: true } });
    if (!file) return 'missing';
    if (!file.originalRelativePath) return 'nothing-to-do';
    const active = await tx.twitchJob.findFirst({ where: { mediaFileId: fileId, state: { in: ACTIVE_JOB_STATES } }, select: { id: true } });
    if (active || await activeDownload(tx, file.videoId)) return 'busy';

    await tx.twitchJob.create({
      data: {
        kind,
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
export async function fileTimeline(fileId: string, videoId: string) {
  const [jobs, deletions] = await Promise.all([
    prisma.twitchJob.findMany({
      where: { OR: [{ mediaFileId: fileId }, { videoId, kind: 'DOWNLOAD' }] },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { id: true, kind: true, state: true, source: true, requestedByUsername: true, createdAt: true, startedAt: true, finishedAt: true },
    }),
    prisma.twitchDeletedFile.findMany({
      where: { videoId, kind: 'ORIGINAL' },
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
