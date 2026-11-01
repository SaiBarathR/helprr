import type { CreatorVideoType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { evaluatePolicy, layerMap, sanitizeLayer, type PolicyDecision, type PolicyLayer, type VideoForPolicy, type VideoTypeKey } from '@/lib/archive/policy';
import { getTwitchSettings } from '@/lib/twitch/settings';

/** The saved layers for one streamer's video type, with an optional unsaved draft on top of the streamer. */
export async function decideForVideo(
  video: VideoForPolicy & { type: CreatorVideoType; creatorId: string },
  draft?: { global?: PolicyLayer; streamer?: PolicyLayer; streamerTypes?: Partial<Record<VideoTypeKey, PolicyLayer>> },
): Promise<PolicyDecision> {
  const [settings, stored] = await Promise.all([
    getTwitchSettings(),
    prisma.creatorPolicy.findUnique({ where: { creatorId: video.creatorId } }),
  ]);
  const type = video.type as VideoTypeKey;
  return evaluatePolicy(video, {
    global: draft?.global ?? sanitizeLayer(settings.defaultPolicy),
    type: layerMap(settings.typePolicies)[type],
    streamer: draft?.streamer ?? sanitizeLayer(stored?.policy),
    streamerType: (draft?.streamerTypes ?? layerMap(stored?.typePolicies))[type],
  }, settings.autoDownloadEnabled);
}
