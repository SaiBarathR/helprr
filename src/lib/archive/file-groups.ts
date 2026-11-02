import type { ArchivePlatform } from '@prisma/client';
import { prisma } from '@/lib/db';
import { buildFileWhere, listFiles, savedBytes, serializeFile } from './files';
import { loadPlayedDates } from './retention';

export const FILES_PER_GROUP = 3;
export const FILE_GROUPS_PER_PAGE = 8;

interface Totals {
  creatorId: string;
  count: number;
  bytes: number;
  newest: number;
  oldest: number;
  saved: number;
}

// What each Library sort means for a whole channel. Largest is the channel using the most space.
const ORDERS: Record<string, (a: Totals, b: Totals) => number> = {
  newest: (a, b) => b.newest - a.newest,
  oldest: (a, b) => a.oldest - b.oldest,
  largest: (a, b) => b.bytes - a.bytes,
  saved: (a, b) => b.saved - a.saved,
};

/** The Library one channel at a time, with the same filters and sort as its plain list. */
export async function fileGroups(
  platform: ArchivePlatform,
  user: Parameters<typeof loadPlayedDates>[0],
  params: URLSearchParams,
) {
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const sort = params.get('sort') ?? 'newest';
  const where = buildFileWhere(params, platform);
  // A library is small, as listFiles already assumes for its saved sort.
  const rows = await prisma.archiveMediaFile.findMany({
    where,
    select: { sizeBytes: true, createdAt: true, reencodedAt: true, originalSizeBytes: true, video: { select: { creatorId: true } } },
  });
  const totals = new Map<string, Totals>();
  for (const row of rows) {
    const { creatorId } = row.video;
    const time = row.createdAt.getTime();
    const entry = totals.get(creatorId) ?? { creatorId, count: 0, bytes: 0, newest: 0, oldest: Infinity, saved: 0 };
    entry.count += 1;
    entry.bytes += Number(row.sizeBytes);
    entry.newest = Math.max(entry.newest, time);
    entry.oldest = Math.min(entry.oldest, time);
    entry.saved += savedBytes(row);
    totals.set(creatorId, entry);
  }
  const order = ORDERS[sort] ?? ORDERS.newest;
  const ordered = [...totals.values()].sort((a, b) => order(a, b) || a.creatorId.localeCompare(b.creatorId));

  const groups = await Promise.all(ordered.slice((page - 1) * FILE_GROUPS_PER_PAGE, page * FILE_GROUPS_PER_PAGE).map(async (entry) => ({
    entry,
    files: await listFiles({ AND: [where, { video: { creatorId: entry.creatorId } }] }, platform, sort, 0, FILES_PER_GROUP),
  })));
  const played = await loadPlayedDates(user, groups.flatMap(({ files }) => files.flatMap((file) => file.jellyfinItemId ?? [])));

  return {
    // A file can go between the count and the read.
    groups: groups.filter(({ files }) => files.length > 0).map(({ entry, files }) => {
      const serialized = files.map((file) => serializeFile(file, file.jellyfinItemId ? played.get(file.jellyfinItemId) : undefined));
      return { creator: serialized[0].creator, total: entry.count, totalBytes: entry.bytes, files: serialized };
    }),
    total: ordered.length,
    videoTotal: rows.length,
    page,
    pageSize: FILE_GROUPS_PER_PAGE,
  };
}
