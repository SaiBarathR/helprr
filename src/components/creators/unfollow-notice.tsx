'use client';

import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import type { PolicyLayer, VideoTypeKey } from '@/lib/archive/policy';

/** What an unfollow answers: see `FollowersLeft` (the count and rules only reach managers). */
export interface UnfollowResult {
  othersFollow?: boolean;
  othersFollowing?: number;
  autoDownload?: boolean;
  channels?: Array<{ id: string; name: string }>;
  moreChannels?: number;
}

/** A playlist's channels whose rules still download, each linked to its rules page. */
function ChannelRuleLinks({ channels, more }: { channels: NonNullable<UnfollowResult['channels']>; more: number }) {
  return (
    <span>
      Download rules:{' '}
      {channels.map((channel, index) => (
        <span key={channel.id}>
          {index > 0 && ', '}
          <Link href={`/youtube/channels/${channel.id}/rules`} className="underline underline-offset-2">
            {channel.name}
          </Link>
        </span>
      ))}
      {more > 0 && ` and ${more} more`}
    </span>
  );
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
 * nothing. Says so, and offers whoever can change the rule a way to turn it off: a button for
 * a channel or streamer, links to the channels' rules for a playlist. Members are told only
 * that someone else follows; managers get the count.
 */
export function showUnfollowNotice({ done, name, result, turnOff }: {
  /** "Unfollowed" or "Unsubscribed". */
  done: string;
  name: string;
  result: UnfollowResult | null;
  turnOff?: () => Promise<void>;
}): void {
  const count = result?.othersFollowing;
  const others = count === undefined ? Boolean(result?.othersFollow) : count > 0;
  const downloads = Boolean(result?.autoDownload);
  if (!others && !downloads) return;
  // With nobody else following, only a followed playlist can still bring its videos in.
  const who = !others ? `A followed playlist still includes ${name}`
    : count === undefined ? `Someone else still follows ${name}`
      : `${count === 1 ? '1 other person still follows' : `${count} other people still follow`} ${name}`;
  const message = `${done}. ${who}${downloads ? ', so new videos can still download.' : '.'}`;
  const channels = downloads ? result?.channels ?? [] : [];
  if (channels.length > 0) {
    toast(message, { duration: 15_000, description: <ChannelRuleLinks channels={channels} more={result?.moreChannels ?? 0} /> });
    return;
  }
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
