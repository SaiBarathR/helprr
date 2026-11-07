import type { ArchivePlatform } from '@prisma/client';
import { BUILT_IN_POLICY, layerMap, sanitizeLayer, type PolicyLayer, type VideoTypeKey } from '@/lib/archive/policy';
import { prisma } from '@/lib/db';
import { getTwitchSettings } from '@/lib/twitch/settings';
import { getYoutubeSettings } from '@/lib/youtube/settings';

const TYPES: Record<ArchivePlatform, VideoTypeKey[]> = {
  TWITCH: ['ARCHIVE', 'HIGHLIGHT', 'UPLOAD'],
  YOUTUBE: ['UPLOAD', 'ARCHIVE', 'SHORT'],
};

type StoredPolicy = { policy: unknown; typePolicies: unknown } | null;

/**
 * Whether some new video would download by rule, before its title or length is known.
 * The layers are those of `decideForVideo` and `decideForYoutubeVideo`, least specific first.
 */
function rulesDownload(
  platform: ArchivePlatform,
  settings: { autoDownloadEnabled: boolean; defaultPolicy: unknown; typePolicies: unknown },
  creator: StoredPolicy,
  playlist?: PolicyLayer,
): boolean {
  if (!settings.autoDownloadEnabled) return false;
  const types = layerMap(settings.typePolicies);
  const own = layerMap(creator?.typePolicies);
  const layers = (type: VideoTypeKey) => [sanitizeLayer(settings.defaultPolicy), types[type], sanitizeLayer(creator?.policy), own[type], playlist];
  return TYPES[platform].some((type) => layers(type).reduce<boolean>((on, layer) => layer?.autoDownload ?? on, BUILT_IN_POLICY.autoDownload));
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
  // A followed YouTube playlist brings in this channel's videos under this channel's rule.
  const stillFound = othersFollowing > 0 || (platform === 'YOUTUBE' && await prisma.creatorPlaylist.count({
    where: { subscriptions: { some: {} }, videos: { some: { video: { creatorId } } } },
  }) > 0);
  if (!stillFound) return { othersFollowing, autoDownload: false };
  const [settings, stored] = await Promise.all([
    platform === 'YOUTUBE' ? getYoutubeSettings() : getTwitchSettings(),
    prisma.creatorPolicy.findUnique({ where: { creatorId } }),
  ]);
  return { othersFollowing, autoDownload: rulesDownload(platform, settings, stored) };
}

/** Each video in a playlist is decided with its own channel's rules under the playlist's. */
export async function playlistFollowersLeft(playlistId: string, canManage: boolean): Promise<FollowersLeft> {
  const othersFollowing = await prisma.creatorPlaylistSubscription.count({ where: { playlistId } });
  if (!canManage) return { othersFollowing };
  if (othersFollowing === 0) return { othersFollowing, autoDownload: false };
  const [settings, list, channels] = await Promise.all([
    getYoutubeSettings(),
    prisma.creatorPlaylist.findUnique({ where: { id: playlistId }, select: { policy: true } }),
    prisma.creatorPolicy.findMany({
      where: { creator: { videos: { some: { playlists: { some: { playlistId } } } } } },
      select: { policy: true, typePolicies: true },
    }),
  ]);
  const own = sanitizeLayer(list?.policy);
  // A channel with no rule of its own, including one not in the playlist yet.
  const autoDownload = [null, ...channels].some((channel) => rulesDownload('YOUTUBE', settings, channel, own));
  return { othersFollowing, autoDownload };
}
