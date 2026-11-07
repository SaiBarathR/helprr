'use client';

import { toast } from 'sonner';
import type { PolicyLayer, VideoTypeKey } from '@/lib/archive/policy';

/** What an unfollow answers: see `creatorFollowersLeft`. */
export interface UnfollowResult {
  othersFollowing?: number;
  autoDownload?: boolean;
}

type StoredLayers = { policy: PolicyLayer; typePolicies: Partial<Record<VideoTypeKey, PolicyLayer>> } | null;

/** Turns auto-download off in the creator's own rule, through the same route as its rules page. */
export async function turnOffAutoDownload(platform: 'twitch' | 'youtube', creatorId: string): Promise<void> {
  const api = `/api/${platform}/policies`;
  // Twitch's routes say streamer and YouTube's say channel, as in `CreatorRules`.
  const [idField, storedField] = platform === 'twitch' ? ['streamerId', 'streamer'] : ['channelId', 'channel'];
  const res = await fetch(`${api}?${idField}=${creatorId}`);
  if (!res.ok) throw new Error('Could not load the rules');
  const stored = ((await res.json()) as Record<string, StoredLayers>)[storedField];
  // A video type's own rule outranks the creator's, so one that turns it on is turned off too.
  const typePolicies = Object.fromEntries(Object.entries(stored?.typePolicies ?? {}).map(([type, layer]) => (
    [type, layer?.autoDownload === undefined ? layer : { ...layer, autoDownload: false }]
  )));
  const saved = await fetch(api, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [idField]: creatorId, policy: { ...stored?.policy, autoDownload: false }, typePolicies }),
  });
  if (!saved.ok) throw new Error('Could not turn off auto-download');
}

/**
 * Following is per person but polling and rules are per creator, so leaving alone may stop
 * nothing. Says so, and offers whoever can change the rule a way to turn it off.
 */
export function showUnfollowNotice({ done, name, result, turnOff }: {
  /** "Unfollowed" or "Unsubscribed". */
  done: string;
  name: string;
  result: UnfollowResult | null;
  turnOff?: () => Promise<void>;
}): void {
  const others = result?.othersFollowing ?? 0;
  const downloads = Boolean(result?.autoDownload);
  if (others <= 0 && !downloads) return;
  // With nobody else following, only a followed playlist can still bring its videos in.
  const who = others <= 0 ? `A followed playlist still includes ${name}`
    : `${others === 1 ? '1 other person still follows' : `${others} other people still follow`} ${name}`;
  const message = `${done}. ${who}${downloads ? ', so new videos can still download.' : '.'}`;
  if (!downloads || !turnOff) {
    toast(message);
    return;
  }
  toast(message, {
    duration: 15_000,
    action: {
      label: 'Turn off auto-download',
      onClick: () => {
        turnOff().then(
          () => toast.success(`Auto-download is off for ${name}`),
          (error: Error) => toast.error(error.message),
        );
      },
    },
  });
}

export const followedBy = (count: number) => `Followed by ${count} ${count === 1 ? 'person' : 'people'}`;
