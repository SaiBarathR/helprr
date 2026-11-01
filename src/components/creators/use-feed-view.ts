'use client';

import { useUIStore } from '@/lib/store';
import { useCreatorPlatform } from './platform';

/** Each section remembers its own grid or list. */
export function useFeedView() {
  const { id } = useCreatorPlatform();
  const view = useUIStore((state) => (id === 'twitch' ? state.twitchFeedView : state.youtubeFeedView));
  const setView = useUIStore((state) => (id === 'twitch' ? state.setTwitchFeedView : state.setYoutubeFeedView));
  return [view, setView] as const;
}
