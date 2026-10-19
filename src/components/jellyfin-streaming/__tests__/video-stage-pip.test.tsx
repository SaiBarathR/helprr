// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ playback: {} as Record<string, unknown>, video: null as unknown }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/jellyfin-streaming/playback-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/jellyfin-streaming/playback-provider')>()),
  useJellyfinPlayback: () => state.playback,
  useJellyfinMediaRef: () => ({ current: state.video }),
}));

import { VideoStage } from '../video-stage';

let root: Root;
let client: QueryClient;
const mediaContainer = document.createElement('div');

function playback(videoExpanded: boolean) {
  const previous = state.playback;
  state.playback = {
    item: { Id: 'item1', Name: 'Movie', Type: 'Movie', MediaType: 'Video' },
    stream: null, status: 'playing', error: null, needsJellyfinConnect: false,
    positionSeconds: 10, durationSeconds: 100, playbackRate: 1, volume: 0.5, muted: false,
    repeat: 'off', shuffled: false, queue: [], queueOpen: false, index: 0, playQueueIndex: 0,
    segments: [], subtitleStreamIndex: null, audioStreamIndex: null, subtitleOffsetSeconds: 0,
    maxBitrate: null, effectiveMaxBitrate: null, videoExpanded,
    // The same spies across renders, so calls add up over a test.
    ...Object.fromEntries([
      'togglePause', 'skip', 'seek', 'setVolume', 'setMuted', 'next', 'previous', 'stop', 'setVideoExpanded',
      'setQueueOpen', 'setRepeat', 'toggleShuffle', 'setPlaybackRate', 'setMaxBitrate', 'setAudioStream',
      'setSubtitleStream', 'setSubtitleOffset', 'skipSegment', 'retryAfterConnect', 'reportChromeObstruction',
    ].map((name) => [name, previous[name] ?? vi.fn()])),
  };
}

const render = (videoExpanded: boolean) => {
  playback(videoExpanded);
  return act(async () => root.render(
    <QueryClientProvider client={client}><VideoStage mediaContainer={mediaContainer} /></QueryClientProvider>,
  ));
};

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  state.playback = {};
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('picture in picture', () => {
  it('leaves no unhandled rejection when the browser refuses it', async () => {
    const refused: unknown[] = [];
    const onRejection = (reason: unknown) => refused.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      // A plain function: a vi.fn would itself handle the promise it returns.
      let requests = 0;
      const requestPictureInPicture = () => {
        requests += 1;
        return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
      };
      const video = document.createElement('video');
      Object.assign(video, { requestPictureInPicture });
      state.video = video;
      await render(true);
      // On a narrow screen the control sits in the player settings panel.
      await act(async () => (document.querySelector('button[aria-label="Player settings"]') as HTMLButtonElement).click());
      const button = document.querySelector('button[aria-label="Picture in picture"]') as HTMLButtonElement;
      await act(async () => button.click());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(requests).toBe(1);
      expect(refused).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
      state.video = null;
    }
  });
});
