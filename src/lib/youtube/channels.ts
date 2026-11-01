import { subscribeToCreator } from '@/lib/archive/subscribe';
import { prisma } from '@/lib/db';
import { channelByHandle, channelById, type YoutubeChannel } from '@/lib/youtube/api';
import type { ChannelQuery } from '@/lib/youtube/ids';
import { YOUTUBE } from '@/lib/youtube/platform';
import { syncChannelVideos } from '@/lib/youtube/sync';

/** A folder from the handle: readable in the library, and safe however odd the handle is. */
export function channelFolderBase(channel: Pick<YoutubeChannel, 'id' | 'handle'>): string {
  const name = (channel.handle ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[.-]+/, '').replace(/\.+$/, '');
  return name || channel.id.toLowerCase();
}

// A handle can pass to another channel, but a folder is never shared.
async function freeFolderName(channel: YoutubeChannel): Promise<string> {
  const name = channelFolderBase(channel);
  const taken = await prisma.creator.findUnique({ where: { platform_folderName: { platform: YOUTUBE, folderName: name } }, select: { id: true } });
  return taken ? `${name}-${channel.id.slice(-6).toLowerCase()}` : name;
}

export async function followChannel(userId: string, query: ChannelQuery) {
  const channel = 'handle' in query ? await channelByHandle(query.handle) : await channelById(query.channelId);
  if (!channel) return null;
  return subscribeToCreator({
    platform: YOUTUBE,
    externalId: channel.id,
    userId,
    profile: {
      login: channel.handle?.replace(/^@/, '') ?? channel.id,
      displayName: channel.title,
      description: channel.description,
      profileImageUrl: channel.avatarUrl,
      offlineImageUrl: channel.bannerUrl,
    },
    folderName: await freeFolderName(channel),
    baseline: (creator) => syncChannelVideos(creator),
  });
}
