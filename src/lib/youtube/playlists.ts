import type { CreatorPlaylist } from '@prisma/client';
import { prisma } from '@/lib/db';
import { channelById, playlistById, playlistItems, videosById, type YoutubeVideo } from '@/lib/youtube/api';
import { freeFolderName, profileOf } from '@/lib/youtube/channels';
import { YOUTUBE } from '@/lib/youtube/platform';
import { toRow } from '@/lib/youtube/sync';

const PAGE_SIZE = 50;
const MAX_PAGES = 10;

async function allItems(playlistId: string) {
  const items: Array<{ videoId: string; position: number }> = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await playlistItems(playlistId, PAGE_SIZE, pageToken);
    items.push(...(result?.items ?? []));
    if (!result?.nextPageToken) break;
    pageToken = result.nextPageToken;
  }
  return items;
}

/** A channel known only through a playlist gets a row but no subscription, so it is not polled. */
async function creatorIdsFor(videos: YoutubeVideo[]): Promise<Map<string, string>> {
  const channelIds = [...new Set(videos.map((video) => video.channelId))];
  const rows = await prisma.creator.findMany({
    where: { platform: YOUTUBE, externalId: { in: channelIds } },
    select: { id: true, externalId: true },
  });
  const ids = new Map(rows.map((row) => [row.externalId, row.id]));
  for (const channelId of channelIds) {
    if (ids.has(channelId)) continue;
    const channel = await channelById(channelId);
    if (!channel) continue;
    const { id } = await prisma.creator.create({
      data: { platform: YOUTUBE, externalId: channel.id, folderName: await freeFolderName(channel), ...profileOf(channel) },
      select: { id: true },
    });
    ids.set(channelId, id);
  }
  return ids;
}

// A followed channel's own sweep announces its videos. Nothing else would, so those are done here.
async function storeVideos(videos: YoutubeVideo[], now: Date): Promise<void> {
  const creators = await creatorIdsFor(videos);
  const followed = new Set((await prisma.creator.findMany({
    where: { id: { in: [...creators.values()] }, subscriptions: { some: {} } },
    select: { id: true },
  })).map((creator) => creator.id));
  await prisma.creatorVideo.createMany({
    data: videos.flatMap((video) => {
      const creatorId = creators.get(video.channelId);
      if (!creatorId) return [];
      return [{ ...toRow(video, creatorId, null), firstSeenAt: now, lastSeenAt: now, notifiedAt: followed.has(creatorId) ? null : now }];
    }),
    skipDuplicates: true,
  });
}

/** A pasted link for a video Helprr has not seen. */
export async function storeVideoById(externalId: string, now = new Date()): Promise<string | null> {
  await storeVideos(await videosById([externalId]), now);
  const row = await prisma.creatorVideo.findUnique({
    where: { platform_externalId: { platform: YOUTUBE, externalId } },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * One unit to see whether anything changed, then the items only if the count moved, so a
 * long list costs the same as a short one on an idle day. Removing a video from a list
 * only removes it from the list: its row and its file stay.
 */
export async function syncPlaylist(
  playlist: Pick<CreatorPlaylist, 'id' | 'externalId' | 'itemCount' | 'baselinedAt'>,
  now = new Date(),
): Promise<{ newVideoIds: string[] }> {
  const info = await playlistById(playlist.externalId);
  if (!info) return { newVideoIds: [] };

  const details = { title: info.title, ownerName: info.ownerName, description: info.description, thumbnailUrl: info.thumbnailUrl, itemCount: info.itemCount };
  const isBaseline = playlist.baselinedAt === null;
  if (!isBaseline && info.itemCount === playlist.itemCount) {
    await prisma.creatorPlaylist.update({ where: { id: playlist.id }, data: details });
    return { newVideoIds: [] };
  }

  const items = await allItems(playlist.externalId);
  const externalIds = items.map((item) => item.videoId);
  const stored = async () => prisma.creatorVideo.findMany({
    where: { platform: YOUTUBE, externalId: { in: externalIds } },
    select: { id: true, externalId: true },
  });
  const known = new Set((await stored()).map((video) => video.externalId));
  // A hidden video in a list has no details, so it simply stays out.
  await storeVideos(await videosById(externalIds.filter((id) => !known.has(id))), now);
  const videoIds = new Map((await stored()).map((video) => [video.externalId, video.id]));

  const members = await prisma.creatorPlaylistVideo.findMany({ where: { playlistId: playlist.id }, select: { videoId: true } });
  const wasIn = new Set(members.map((member) => member.videoId));
  const rows = items.flatMap((item) => {
    const videoId = videoIds.get(item.videoId);
    return videoId ? [{ playlistId: playlist.id, videoId, position: item.position, createdAt: now }] : [];
  });
  const added = rows.filter((row) => !wasIn.has(row.videoId));
  await prisma.creatorPlaylistVideo.createMany({ data: added, skipDuplicates: true });
  await prisma.creatorPlaylistVideo.deleteMany({
    where: { playlistId: playlist.id, videoId: { notIn: rows.map((row) => row.videoId) } },
  });
  for (const row of rows) {
    if (wasIn.has(row.videoId)) {
      await prisma.creatorPlaylistVideo.update({
        where: { playlistId_videoId: { playlistId: playlist.id, videoId: row.videoId } },
        data: { position: row.position },
      });
    }
  }

  await prisma.creatorPlaylist.update({
    where: { id: playlist.id },
    data: { ...details, ...(isBaseline ? { baselinedAt: now } : {}) },
  });
  return { newVideoIds: isBaseline ? [] : added.map((row) => row.videoId) };
}

/** Subscribes a user. Following a list nobody watched takes a new silent baseline, as with a channel. */
export async function followPlaylist(userId: string, playlistId: string) {
  const info = await playlistById(playlistId);
  if (!info) return null;

  const key = { platform_externalId: { platform: YOUTUBE, externalId: info.id } };
  const existing = await prisma.creatorPlaylist.findUnique({ where: key, select: { _count: { select: { subscriptions: true } } } });
  const details = { title: info.title, ownerName: info.ownerName, description: info.description, thumbnailUrl: info.thumbnailUrl };
  const playlist = await prisma.creatorPlaylist.upsert({
    where: key,
    update: { ...details, ...(existing?._count.subscriptions === 0 ? { baselinedAt: null, nextCheckAt: null } : {}) },
    create: { platform: YOUTUBE, externalId: info.id, ...details },
  });
  const subscription = await prisma.creatorPlaylistSubscription.upsert({
    where: { userId_playlistId: { userId, playlistId: playlist.id } },
    update: {},
    create: { userId, playlistId: playlist.id },
  });
  if (!playlist.baselinedAt) await syncPlaylist(playlist);
  return { playlist, subscription };
}
