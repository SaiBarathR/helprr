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

// Channel rule links in a playlist unfollow notice; the rest are counted.
const PLAYLIST_CHANNEL_LINKS = 3;

export interface FollowersLeft {
  /** Whether anyone else still follows. Everyone gets this. */
  othersFollow: boolean;
  /** How many others still follow: only for someone who may change the rules. */
  othersFollowing?: number;
  /** Only for someone who may change the rules. */
  autoDownload?: boolean;
  /** Playlists, for someone who may change the rules: its channels whose rules still download. */
  channels?: Array<{ id: string; name: string }>;
  /** Further such channels, left out of `channels`. */
  moreChannels?: number;
}

/**
 * Polling and rules are per creator, not per person: while anyone else follows, it is still
 * checked and its rule still downloads. Said after an unfollow, so that is never a surprise.
 * Members hear only that someone else follows, never how many.
 */
export async function creatorFollowersLeft(platform: ArchivePlatform, creatorId: string, canManage: boolean): Promise<FollowersLeft> {
  const othersFollowing = await prisma.creatorSubscription.count({ where: { creatorId } });
  if (!canManage) return { othersFollow: othersFollowing > 0 };
  // A followed YouTube playlist brings in this channel's videos under this channel's rule.
  const stillFound = othersFollowing > 0 || (platform === 'YOUTUBE' && await prisma.creatorPlaylist.count({
    where: { subscriptions: { some: {} }, videos: { some: { video: { creatorId } } } },
  }) > 0);
  const othersFollow = othersFollowing > 0;
  if (!stillFound) return { othersFollow, othersFollowing, autoDownload: false };
  const [settings, stored] = await Promise.all([
    platform === 'YOUTUBE' ? getYoutubeSettings() : getTwitchSettings(),
    prisma.creatorPolicy.findUnique({ where: { creatorId } }),
  ]);
  return { othersFollow, othersFollowing, autoDownload: rulesDownload(platform, settings, stored) };
}

/** Each video in a playlist is decided with its own channel's rules under the playlist's. */
export async function playlistFollowersLeft(playlistId: string, canManage: boolean): Promise<FollowersLeft> {
  const othersFollowing = await prisma.creatorPlaylistSubscription.count({ where: { playlistId } });
  const othersFollow = othersFollowing > 0;
  if (!canManage) return { othersFollow };
  if (!othersFollow) return { othersFollow, othersFollowing, autoDownload: false };
  const [settings, list, channels] = await Promise.all([
    getYoutubeSettings(),
    prisma.creatorPlaylist.findUnique({ where: { id: playlistId }, select: { policy: true } }),
    prisma.creator.findMany({
      where: { videos: { some: { playlists: { some: { playlistId } } } } },
      select: { id: true, displayName: true, policy: { select: { policy: true, typePolicies: true } } },
      orderBy: { displayName: 'asc' },
    }),
  ]);
  const own = sanitizeLayer(list?.policy);
  const downloading = channels.filter((channel) => rulesDownload('YOUTUBE', settings, channel.policy, own));
  // Or a channel with no rule of its own that is not in the playlist yet.
  const autoDownload = downloading.length > 0 || rulesDownload('YOUTUBE', settings, null, own);
  return {
    othersFollow,
    othersFollowing,
    autoDownload,
    channels: downloading.slice(0, PLAYLIST_CHANNEL_LINKS).map((channel) => ({ id: channel.id, name: channel.displayName })),
    moreChannels: Math.max(0, downloading.length - PLAYLIST_CHANNEL_LINKS),
  };
}
