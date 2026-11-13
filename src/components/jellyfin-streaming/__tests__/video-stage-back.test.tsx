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
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { resetOverlayHistoryForTests } from '@/lib/overlay-history';

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

const render = (videoExpanded: boolean, dialogOpen: boolean) => {
  playback(videoExpanded);
  return act(async () => root.render(
    <QueryClientProvider client={client}>
      <VideoStage mediaContainer={mediaContainer} />
      <Dialog open={dialogOpen} onOpenChange={() => {}}>
        <DialogContent>
          <DialogTitle>Watch detail</DialogTitle>
        </DialogContent>
      </Dialog>
    </QueryClientProvider>,
  ));
};
const tick = (ms = 30) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const spy = (name: string) => state.playback[name] as ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  resetOverlayHistoryForTests();
  window.history.pushState({ __NA: true }, '', '/watch');
  state.playback = {};
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('the expanded player and Back', () => {
  // Play in the Watch modal closes the modal and expands the player in one
  // click; the modal taking its history entry off is not the user's Back.
  it('stays expanded when a dialog closing takes its own entry off', async () => {
    await render(false, true);
    await tick();
    expect((window.history.state as Record<string, unknown>).__helprrOverlay).toBeDefined();
    await render(true, false);
    await tick(80);
    expect((window.history.state as Record<string, unknown>).__helprrOverlay).toBeUndefined();
    expect(spy('setVideoExpanded')).not.toHaveBeenCalled();
  });

  it('stays expanded when Back only closes a dialog over it', async () => {
    await render(true, true);
    await tick();
    await act(async () => { window.history.back(); });
    await tick(80);
    expect(spy('setVideoExpanded')).not.toHaveBeenCalled();
  });

  it('collapses on a Back with nothing open over it', async () => {
    await render(true, false);
    window.history.pushState({ __NA: true }, '', '/watch/item1');
    await act(async () => { window.history.back(); });
    await tick(80);
    expect(spy('setVideoExpanded')).toHaveBeenCalledWith(false);
  });
});
