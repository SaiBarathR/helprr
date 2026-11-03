import type { ArchivePlatform } from '@prisma/client';
import { prisma } from '@/lib/db';
import { buildFeedWhere } from './feed';
import { VIDEO_SELECT, type VideoRow } from './serialize-video';

export const GROUP_SIZE = 10;
export const GROUPS_PER_PAGE = 8;

/**
 * The feed one creator at a time, with the same filters as the plain feed. The creator whose
 * newest video is newest comes first. "New" uses the feed's own New filter, so it matches it.
 */
export async function feedGroups<T>(
  platform: ArchivePlatform,
  userId: string,
  params: URLSearchParams,
  serialize: (video: VideoRow, seenAt?: Date | null) => T,
) {
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const newOnly = new URLSearchParams(params);
  newOnly.set('segment', 'new');
  const [where, newWhere] = await Promise.all([
    buildFeedWhere(platform, userId, params),
    buildFeedWhere(platform, userId, newOnly),
  ]);
  const [summary, news] = await Promise.all([
    prisma.creatorVideo.groupBy({ by: ['creatorId'], where, _count: { _all: true }, _max: { sourceCreatedAt: true } }),
    prisma.creatorVideo.groupBy({ by: ['creatorId'], where: newWhere, _count: { _all: true } }),
  ]);
  const ordered = summary.sort((a, b) => (
    (b._max.sourceCreatedAt?.getTime() ?? 0) - (a._max.sourceCreatedAt?.getTime() ?? 0) || a.creatorId.localeCompare(b.creatorId)
  ));
  const newCounts = new Map(news.map((row) => [row.creatorId, row._count._all]));

  const groups = await Promise.all(ordered.slice((page - 1) * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE).map(async ({ creatorId, _count }) => {
    const videos = await prisma.creatorVideo.findMany({
      where: { AND: [where, { creatorId }] },
      orderBy: [{ sourceCreatedAt: 'desc' }, { id: 'desc' }],
      take: GROUP_SIZE,
      select: { ...VIDEO_SELECT, userStates: { where: { userId }, select: { seenAt: true } } },
    });
    return {
      creator: videos[0]?.creator,
      total: _count._all,
      newCount: newCounts.get(creatorId) ?? 0,
      videos: videos.map(({ userStates, ...video }) => serialize(video, userStates[0]?.seenAt)),
    };
  }));

  return {
    // A video can vanish between the count and the read.
    groups: groups.filter((group) => group.creator),
    total: ordered.length,
    videoTotal: ordered.reduce((sum, row) => sum + row._count._all, 0),
    page,
    pageSize: GROUPS_PER_PAGE,
  };
}
