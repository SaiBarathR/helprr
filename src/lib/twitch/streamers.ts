import { subscribeToCreator } from '@/lib/archive/subscribe';
import { helixGet } from '@/lib/twitch/helix';
import { syncStreamerVideos } from '@/lib/twitch/sync';
import { TWITCH } from '@/lib/twitch/platform';

interface HelixUser {
  id: string;
  login: string;
  display_name: string;
  description: string;
  profile_image_url: string;
  offline_image_url: string;
  broadcaster_type: string;
}

const LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/;
const RESERVED_PATHS = new Set(['videos', 'directory', 'settings', 'subscriptions', 'wallet', 'p', 'downloads']);

/** A login from a bare name or any twitch.tv link. It later names a folder, so it must match Twitch's own format. */
export function parseTwitchLogin(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  const match = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#]+)/.exec(trimmed);
  const login = match ? match[1] : trimmed.replace(/^@/, '');
  if (!LOGIN_PATTERN.test(login) || (match && RESERVED_PATHS.has(login))) return null;
  return login;
}

/** Subscribes a user, creating the streamer and its baseline on first sight. */
export async function subscribeToStreamer(userId: string, login: string) {
  const { data } = await helixGet<HelixUser>('/users', { login });
  const user = data[0];
  if (!user) return null;

  const { creator, subscription } = await subscribeToCreator({
    platform: TWITCH,
    externalId: user.id,
    userId,
    profile: {
      login: user.login,
      displayName: user.display_name,
      description: user.description || null,
      profileImageUrl: user.profile_image_url || null,
      offlineImageUrl: user.offline_image_url || null,
      broadcasterType: user.broadcaster_type,
    },
    folderName: user.login,
    baseline: (streamer) => syncStreamerVideos(streamer),
  });
  return { streamer: creator, subscription };
}
