import type { CreatorVideoType, Prisma } from '@prisma/client';
import { DEFAULT_YOUTUBE_OPTIONS, type DownloadOptions } from '@/lib/archive/jobs';
import {
  BUILT_IN_POLICY, evaluatePolicy, layerMap, sanitizeLayer, type PolicyDecision, type PolicyLayer, type TwitchPolicy, type VideoForPolicy, type VideoTypeKey,
} from '@/lib/archive/policy';
import { prisma } from '@/lib/db';
import { getYoutubeSettings } from '@/lib/youtube/settings';

// Three hours: higher qualities and SponsorBlock segments both take time to appear.
export const YOUTUBE_BUILT_IN_POLICY: TwitchPolicy = { ...BUILT_IN_POLICY, ...DEFAULT_YOUTUBE_OPTIONS, delayMinutes: 180 };

export const POLICY_VIDEO = {
  id: true, title: true, type: true, category: true, creatorId: true, durationSeconds: true, sourceCreatedAt: true, liveEndedAt: true,
} satisfies Prisma.CreatorVideoSelect;

interface Draft {
  global?: PolicyLayer;
  channel?: PolicyLayer;
  channelTypes?: Partial<Record<VideoTypeKey, PolicyLayer>>;
  playlistId?: string;
}

/** The saved layers for one video, with an optional unsaved draft on top. */
export async function decideForYoutubeVideo(
  video: VideoForPolicy & { type: CreatorVideoType; creatorId: string },
  draft?: Draft,
): Promise<PolicyDecision> {
  const [settings, stored, list] = await Promise.all([
    getYoutubeSettings(),
    prisma.creatorPolicy.findUnique({ where: { creatorId: video.creatorId } }),
    draft?.playlistId ? prisma.creatorPlaylist.findUnique({ where: { id: draft.playlistId }, select: { policy: true } }) : null,
  ]);
  const type = video.type as VideoTypeKey;
  return evaluatePolicy(video, {
    global: draft?.global ?? sanitizeLayer(settings.defaultPolicy),
    type: layerMap(settings.typePolicies)[type],
    streamer: draft?.channel ?? sanitizeLayer(stored?.policy),
    streamerType: (draft?.channelTypes ?? layerMap(stored?.typePolicies))[type],
    playlist: sanitizeLayer(list?.policy),
  }, settings.autoDownloadEnabled, YOUTUBE_BUILT_IN_POLICY);
}

export function optionsFromPolicy(policy: TwitchPolicy): DownloadOptions {
  const { quality, codec, chat, chapters, captions, sponsorblock, reencode, keepForever } = policy;
  return { quality, codec, chat, chapters, captions, sponsorblock, reencode, keepForever };
}

/** From publishing, or from the end of a stream, whichever came last. */
export function settleTime(
  video: { sourceCreatedAt: Date; liveEndedAt: Date | null },
  policy: Pick<TwitchPolicy, 'delayMinutes'>,
  now: Date,
): Date {
  const from = video.liveEndedAt && video.liveEndedAt > video.sourceCreatedAt ? video.liveEndedAt : video.sourceCreatedAt;
  const ready = new Date(from.getTime() + (policy.delayMinutes ?? 0) * 60_000);
  return ready > now ? ready : now;
}
