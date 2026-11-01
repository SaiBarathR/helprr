import { prisma } from '@/lib/db';
import { helixGet } from '@/lib/twitch/helix';
import { syncStreamerVideos } from '@/lib/twitch/sync';
import { logger } from '@/lib/logger';
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

  const profile = {
    login: user.login,
    displayName: user.display_name,
    description: user.description || null,
    profileImageUrl: user.profile_image_url || null,
    offlineImageUrl: user.offline_image_url || null,
    broadcasterType: user.broadcaster_type,
  };
  const key = { platform_externalId: { platform: TWITCH, externalId: user.id } };
  const existing = await prisma.creator.findUnique({
    where: key,
    select: { _count: { select: { subscriptions: true } } },
  });
  // Unwatched for a while: what was published meanwhile is history, not news.
  const unwatched = existing?._count.subscriptions === 0;
  const streamer = await prisma.creator.upsert({
    where: key,
    update: { ...profile, ...(unwatched ? { baselinedAt: null, nextVideosCheckAt: null } : {}) },
    create: { platform: TWITCH, externalId: user.id, folderName: user.login, ...profile },
  });
  const subscription = await prisma.creatorSubscription.upsert({
    where: { userId_creatorId: { userId, creatorId: streamer.id } },
    update: {},
    create: { userId, creatorId: streamer.id },
  });

  if (!streamer.baselinedAt) {
    try {
      await syncStreamerVideos(streamer);
      // A recording that published during the gap is already stored, so the sweep skips it.
      if (unwatched) {
        await prisma.creatorVideo.updateMany({
          where: { creatorId: streamer.id, notifiedAt: null, availability: 'PUBLISHED' },
          data: { notifiedAt: new Date() },
        });
      }
    } catch (error) {
      // nextVideosCheckAt is still null, so the next poll takes the baseline instead.
      logger.warn('Twitch baseline failed', { streamerId: streamer.id, error: String(error) }, { scope: 'twitch' });
    }
  }
  return { streamer, subscription };
}
