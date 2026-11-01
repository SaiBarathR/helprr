'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Capability } from '@/lib/capabilities';

/** What the shared pages and rows need to know about the section they are in. */
export interface CreatorPlatform {
  id: 'twitch';
  name: string;
  /** Where its API, pages and cached queries live. */
  api: string;
  base: string;
  creatorsPath: string;
  videoPath: string;
  creatorLabel: string;
  creatorsLabel: string;
  canDownload: Capability;
  canManage: Capability;
  externalVideoUrl: (externalId: string) => string;
}

const PLATFORMS: Record<CreatorPlatform['id'], CreatorPlatform> = {
  twitch: {
    id: 'twitch',
    name: 'Twitch',
    api: '/api/twitch',
    base: '/twitch',
    creatorsPath: '/twitch/streamers',
    videoPath: '/twitch/vod',
    creatorLabel: 'Streamer',
    creatorsLabel: 'Streamers',
    canDownload: 'twitch.download',
    canManage: 'twitch.manage',
    externalVideoUrl: (externalId) => `https://www.twitch.tv/videos/${externalId}`,
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
