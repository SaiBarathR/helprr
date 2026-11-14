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

function playback(videoExpanded: boolean, extra: Record<string, unknown> = {}) {
  const previous = state.playback;
  state.playback = {
    item: { Id: 'item1', Name: 'Movie', Type: 'Movie', MediaType: 'Video' },
    stream: null, status: 'playing', error: null, needsJellyfinConnect: false,
    positionSeconds: 10, durationSeconds: 100, playbackRate: 1, volume: 0.5, muted: false,
    repeat: 'off', shuffled: false, queue: [], queueOpen: false, index: 0, playQueueIndex: 0,
    segments: [], subtitleStreamIndex: null, audioStreamIndex: null, subtitleOffsetSeconds: 0,
    maxBitrate: null, effectiveMaxBitrate: null, videoExpanded, ...extra,
    // The same spies across renders, so calls add up over a test.
    ...Object.fromEntries([
      'togglePause', 'skip', 'seek', 'setVolume', 'setMuted', 'next', 'previous', 'stop', 'setVideoExpanded',
      'setQueueOpen', 'setRepeat', 'toggleShuffle', 'setPlaybackRate', 'setMaxBitrate', 'setAudioStream',
      'setSubtitleStream', 'setSubtitleOffset', 'skipSegment', 'retryAfterConnect', 'reportChromeObstruction',
    ].map((name) => [name, previous[name] ?? vi.fn()])),
  };
}

const render = (videoExpanded: boolean, extra: Record<string, unknown> = {}) => {
  playback(videoExpanded, extra);
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
  state.video = null;
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

  it('Escape closes the top-most layer first: the queue, then an open panel, then the player', async () => {
    state.video = document.createElement('video');
    await render(true, { queueOpen: true, queue: [{ Id: 'item1' }, { Id: 'item2' }] });
    await act(async () => (document.querySelector('button[aria-label="Player settings"]') as HTMLButtonElement).click());
    expect(document.querySelector('[data-player-panel]')).not.toBeNull();

    await press('Escape');
    expect(spy('setQueueOpen')).toHaveBeenCalledWith(false);
    expect(spy('setVideoExpanded')).not.toHaveBeenCalled();

    await render(true, { queueOpen: false });
    await press('Escape');
    expect(document.querySelector('[data-player-panel]')).toBeNull();
    expect(spy('setVideoExpanded')).not.toHaveBeenCalled();

    await press('Escape');
    expect(spy('setVideoExpanded')).toHaveBeenCalledWith(false);
    expect(spy('setQueueOpen')).toHaveBeenCalledTimes(1);
  });
});

describe('the audio and subtitles panel', () => {
  it('marks the playing tracks as checked radios, not only by colour', async () => {
    state.video = document.createElement('video');
    const MediaStreams = [
      { Type: 'Audio', Index: 1, DisplayTitle: 'English' },
      { Type: 'Audio', Index: 2, DisplayTitle: 'Japanese' },
      { Type: 'Subtitle', Index: 3, DisplayTitle: 'English CC' },
    ];
    await render(true, {
      stream: { mediaSource: { MediaStreams }, item: { Id: 'item1' }, subtitleTracks: [] },
      audioStreamIndex: 2, subtitleStreamIndex: null,
    });
    await act(async () => (document.querySelector('button[aria-label="Audio and subtitles"]') as HTMLButtonElement).click());

    const group = (label: string) => document.querySelector(`[role="radiogroup"][aria-label="${label}"]`)!;
    const checked = (label: string) => [...group(label).querySelectorAll('[role="radio"]')]
      .map((radio) => `${radio.textContent}:${radio.getAttribute('aria-checked')}`);
    expect(checked('Audio')).toEqual(['English:false', 'Japanese:true']);
    expect(checked('Subtitles')).toEqual(['Off:true', 'English CC:false']);
  });
});
