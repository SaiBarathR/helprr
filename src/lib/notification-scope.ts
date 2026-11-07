import type { Prisma } from '@prisma/client';
import type { NotificationEventType } from './notification-events';

/**
 * Alerts every follower gets their own copy of. An admin still sees everyone's requests and
 * alerts, but only their own copy of these: one new video is one row, however many follow it.
 * A watchlisted title arriving is the same: one copy per person who has it on their watchlist,
 * and so is a new episode of a show someone is watching.
 */
export const FOLLOWER_EVENT_TYPES: NotificationEventType[] = [
  'watchlistAvailable', 'watchingNewEpisode',
  'youtubeVideoNew', 'youtubeDownloadComplete', 'youtubeDownloadFailed',
  'twitchVodNew', 'twitchVodExpiring', 'twitchDownloadComplete', 'twitchDownloadFailed',
];

/** What a person's list, badge, mark-read and delete cover: members their own, admins all but others' follower copies. */
export function historyScope(user: { id: string; role: string }): Prisma.NotificationHistoryWhereInput {
  if (user.role !== 'admin') return { userId: user.id };
  return { OR: [{ eventType: { notIn: FOLLOWER_EVENT_TYPES } }, { userId: user.id }, { userId: null }] };
}
