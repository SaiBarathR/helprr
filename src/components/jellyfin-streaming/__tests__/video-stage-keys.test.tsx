// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ playback: {} as Record<string, unknown> }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/jellyfin-streaming/playback-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/jellyfin-streaming/playback-provider')>()),
  useJellyfinPlayback: () => state.playback,
  useJellyfinMediaRef: () => ({ current: null }),
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
const press = (key: string) => act(async () => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
});
const spy = (name: string) => state.playback[name] as ReturnType<typeof vi.fn>;

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

describe('the player keyboard shortcuts', () => {
  it('are not bound while the player is collapsed', async () => {
    await render(false);
    for (const key of [' ', 'k', 'n', 'p', 'ArrowRight', 'm', '5']) await press(key);

    for (const name of ['togglePause', 'next', 'previous', 'skip', 'setMuted', 'seek']) {
      expect(spy(name), name).not.toHaveBeenCalled();
    }
  });

  it('are bound once while it is expanded, and unbound when it collapses', async () => {
    await render(true);
    await press(' ');
    expect(spy('togglePause')).toHaveBeenCalledTimes(1);

    await render(false);
    await press(' ');
    await press('n');
    expect(spy('togglePause')).toHaveBeenCalledTimes(1);
    expect(spy('next')).not.toHaveBeenCalled();
  });
});
