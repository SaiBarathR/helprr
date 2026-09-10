'use client';

import { JellyfinPlaybackProvider } from '@/components/jellyfin-streaming/playback-provider';
import { PlayerHost } from '@/components/jellyfin-streaming/player-host';

export function JellyfinStreamingRoot({ children }: { children: React.ReactNode }) {
  return (
    <JellyfinPlaybackProvider>
      {children}
      <PlayerHost />
    </JellyfinPlaybackProvider>
  );
}
