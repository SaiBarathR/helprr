import type { CreatorVideo, PrismaClient } from '@prisma/client';

/** Numbered once and never again, however many times the file is downloaded. */
export async function nextSequentialEpisode(prisma: PrismaClient, video: CreatorVideo, season: number, kind: string) {
  if (video.seasonEpisode !== null) return { season, episode: video.seasonEpisode };
  const episode = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`twitch-season:${video.creatorId}:${kind}`}))`;
    const { _max } = await tx.creatorVideo.aggregate({
      where: { creatorId: video.creatorId, type: video.type },
      _max: { seasonEpisode: true },
    });
    const next = (_max.seasonEpisode ?? 0) + 1;
    await tx.creatorVideo.update({ where: { id: video.id }, data: { seasonEpisode: next } });
    return next;
  });
  return { season, episode };
}
