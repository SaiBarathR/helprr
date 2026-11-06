import type { ArchivePlatform } from '@prisma/client';
import { BUILT_IN_POLICY, layerMap, sanitizeLayer, type PolicyLayer, type VideoTypeKey } from '@/lib/archive/policy';
import { prisma } from '@/lib/db';
import { getTwitchSettings } from '@/lib/twitch/settings';
import { getYoutubeSettings } from '@/lib/youtube/settings';

const TYPES: Record<ArchivePlatform, VideoTypeKey[]> = {
  TWITCH: ['ARCHIVE', 'HIGHLIGHT', 'UPLOAD'],
  YOUTUBE: ['UPLOAD', 'ARCHIVE', 'SHORT'],
};

/** What the layers say, least specific first, before a video's title or length is known. */
const isOn = (layers: Array<PolicyLayer | undefined>) =>
  layers.reduce<boolean>((on, layer) => layer?.autoDownload ?? on, BUILT_IN_POLICY.autoDownload);

/** Whether some new video of this creator would download by rule. */
async function creatorAutoDownloads(platform: ArchivePlatform, creatorId: string): Promise<boolean> {
  const [settings, stored] = await Promise.all([
    platform === 'YOUTUBE' ? getYoutubeSettings() : getTwitchSettings(),
    prisma.creatorPolicy.findUnique({ where: { creatorId } }),
  ]);
  if (!settings.autoDownloadEnabled) return false;
  const types = layerMap(settings.typePolicies);
  const own = layerMap(stored?.typePolicies);
  return TYPES[platform].some((type) => isOn([
    sanitizeLayer(settings.defaultPolicy), types[type], sanitizeLayer(stored?.policy), own[type],
  ]));
}

/** A playlist's own layer over the global ones. A video's channel rule can still turn it on. */
async function playlistAutoDownloads(playlistId: string): Promise<boolean> {
  const [settings, list] = await Promise.all([
    getYoutubeSettings(),
    prisma.creatorPlaylist.findUnique({ where: { id: playlistId }, select: { policy: true } }),
  ]);
  if (!settings.autoDownloadEnabled) return false;
  const types = layerMap(settings.typePolicies);
  const own = sanitizeLayer(list?.policy);
  return TYPES.YOUTUBE.some((type) => isOn([sanitizeLayer(settings.defaultPolicy), types[type], own]));
}

export interface FollowersLeft {
  othersFollowing: number;
  /** Only for someone who may change the rules. */
  autoDownload?: boolean;
}

/**
 * Polling and rules are per creator, not per person: while anyone else follows, it is still
 * checked and its rule still downloads. Said after an unfollow, so that is never a surprise.
 */
export async function creatorFollowersLeft(platform: ArchivePlatform, creatorId: string, canManage: boolean): Promise<FollowersLeft> {
  const othersFollowing = await prisma.creatorSubscription.count({ where: { creatorId } });
  if (!canManage) return { othersFollowing };
  // Nobody left means nothing polls it, so nothing can download.
  return { othersFollowing, autoDownload: othersFollowing > 0 && await creatorAutoDownloads(platform, creatorId) };
}

export async function playlistFollowersLeft(playlistId: string, canManage: boolean): Promise<FollowersLeft> {
  const othersFollowing = await prisma.creatorPlaylistSubscription.count({ where: { playlistId } });
  if (!canManage) return { othersFollowing };
  return { othersFollowing, autoDownload: othersFollowing > 0 && await playlistAutoDownloads(playlistId) };
}
