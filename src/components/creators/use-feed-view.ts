'use client';

import { useUIStore } from '@/lib/store';
import { useCreatorPlatform } from './platform';

/** Each section remembers its own view. */
export function useFeedView() {
  const { id } = useCreatorPlatform();
  const view = useUIStore((state) => (id === 'twitch' ? state.twitchFeedView : state.youtubeFeedView));
  const setView = useUIStore((state) => (id === 'twitch' ? state.setTwitchFeedView : state.setYoutubeFeedView));
  return [view, setView] as const;
}

/** Each Library remembers its own view too. */
export function useLibraryView() {
  const { id } = useCreatorPlatform();
  const view = useUIStore((state) => (id === 'twitch' ? state.twitchLibraryView : state.youtubeLibraryView));
  const setView = useUIStore((state) => (id === 'twitch' ? state.setTwitchLibraryView : state.setYoutubeLibraryView));
  return [view, setView] as const;
}

/** A channel or a playlist is already one source, so grouped shows as the grid there. */
export function useFeedLayout(): 'grid' | 'list' {
  const [view] = useFeedView();
  return view === 'list' ? 'list' : 'grid';
}
