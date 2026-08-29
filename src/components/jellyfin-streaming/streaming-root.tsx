'use client';

import { JellyfinPlaybackProvider } from '@/components/jellyfin-streaming/playback-provider';
import { VideoStage } from '@/components/jellyfin-streaming/video-stage';
import { NowPlayingBar } from '@/components/jellyfin-streaming/now-playing-bar';

export function JellyfinStreamingRoot({ children }: { children: React.ReactNode }) {
  return (
    <JellyfinPlaybackProvider>
      {children}
      <VideoStage />
      <NowPlayingBar />
    </JellyfinPlaybackProvider>
  );
}
