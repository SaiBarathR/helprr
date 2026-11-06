'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Capability } from '@/lib/capabilities';
import { isChannelId } from '@/lib/youtube/ids';
import { VIDEO_TYPE_LABELS, type CreatorVideoItem } from './types';

/** What the shared pages and rows need to know about the section they are in. */
export interface CreatorPlatform {
  id: 'twitch' | 'youtube';
  name: string;
  /** Where its API, pages and cached queries live. */
  api: string;
  base: string;
  creatorsApi: string;
  creatorsPath: string;
  videoPath: string;
  creatorLabel: string;
  creatorsLabel: string;
  followLabel: string;
  unfollowLabel: string;
  unfollowedLabel: string;
  recordingLabel: string;
  canDownload: Capability;
  canManage: Capability;
  /** Videos leave the site by themselves, so a deadline is worth showing. */
  expires: boolean;
  downloads: boolean;
  autoDownload: boolean;
  videoTypes: Array<{ id: string; label: string }>;
  creatorTabs: Array<{ id: string; label: string }>;
  /** The type shown on a card, or nothing when it is the type most videos are. */
  cardTypeLabel: (type: CreatorVideoItem['type']) => string | null;
  externalVideoUrl: (externalId: string) => string;
  externalCreatorUrl: (creator: { login: string }) => string;
  followBody: (login: string) => Record<string, string>;
}

const PLATFORMS: Record<CreatorPlatform['id'], CreatorPlatform> = {
  twitch: {
    id: 'twitch',
    name: 'Twitch',
    api: '/api/twitch',
    base: '/twitch',
    creatorsApi: '/api/twitch/streamers',
    creatorsPath: '/twitch/streamers',
    videoPath: '/twitch/vod',
    creatorLabel: 'Streamer',
    creatorsLabel: 'Streamers',
    followLabel: 'Subscribe',
    unfollowLabel: 'Unsubscribe',
    unfollowedLabel: 'Unsubscribed',
    recordingLabel: 'Recording',
    canDownload: 'twitch.download',
    canManage: 'twitch.manage',
    expires: true,
    downloads: true,
    autoDownload: true,
    videoTypes: [
      { id: 'ARCHIVE', label: 'Past broadcasts' },
      { id: 'HIGHLIGHT', label: 'Highlights' },
      { id: 'UPLOAD', label: 'Uploads' },
    ],
    creatorTabs: [
      { id: 'ARCHIVE', label: 'Videos' },
      { id: 'HIGHLIGHT', label: 'Highlights' },
      { id: 'UPLOAD', label: 'Uploads' },
    ],
    cardTypeLabel: (type) => (type === 'ARCHIVE' ? null : VIDEO_TYPE_LABELS[type]),
    externalVideoUrl: (externalId) => `https://www.twitch.tv/videos/${externalId}`,
    externalCreatorUrl: ({ login }) => `https://www.twitch.tv/${login}`,
    followBody: (login) => ({ login }),
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    api: '/api/youtube',
    base: '/youtube',
    creatorsApi: '/api/youtube/channels',
    creatorsPath: '/youtube/channels',
    videoPath: '/youtube/video',
    creatorLabel: 'Channel',
    creatorsLabel: 'Channels',
    followLabel: 'Follow',
    unfollowLabel: 'Unfollow',
    unfollowedLabel: 'Unfollowed',
    recordingLabel: 'Live',
    canDownload: 'youtube.download',
    canManage: 'youtube.manage',
    expires: false,
    downloads: true,
    autoDownload: true,
    videoTypes: [
      { id: 'UPLOAD', label: 'Videos' },
      { id: 'ARCHIVE', label: 'Live replays' },
      { id: 'SHORT', label: 'Shorts' },
    ],
    creatorTabs: [
      { id: 'UPLOAD', label: 'Videos' },
      { id: 'ARCHIVE', label: 'Live' },
      { id: 'SHORT', label: 'Shorts' },
    ],
    cardTypeLabel: (type) => (type === 'ARCHIVE' ? 'Live replay' : type === 'SHORT' ? 'Short' : null),
    externalVideoUrl: (externalId) => `https://www.youtube.com/watch?v=${externalId}`,
    externalCreatorUrl: ({ login }) => `https://www.youtube.com/${isChannelId(login) ? `channel/${login}` : `@${login}`}`,
    followBody: (login) => ({ input: isChannelId(login) ? login : `@${login}` }),
  },
};

const PlatformContext = createContext<CreatorPlatform | null>(null);

export function CreatorPlatformProvider({ platform, children }: { platform: CreatorPlatform['id']; children: ReactNode }) {
  return <PlatformContext.Provider value={PLATFORMS[platform]}>{children}</PlatformContext.Provider>;
}

/** No default: a page outside a section should fail, not quietly show another platform's data. */
export function useCreatorPlatform(): CreatorPlatform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error('useCreatorPlatform needs a CreatorPlatformProvider');
  return platform;
}
