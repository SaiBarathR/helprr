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
let coarsePointer = false;
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

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)' && coarsePointer, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
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

describe('player chrome in every theme', () => {
  afterEach(() => { coarsePointer = false; state.video = null; });

  it('gives its panels their own dark surface, not the theme-following glass material', async () => {
    state.video = document.createElement('video');
    await render(true);
    await act(async () => (document.querySelector('button[aria-label="Player settings"]') as HTMLButtonElement).click());
    const panel = document.querySelector('[data-player-panel]') as HTMLElement;
    // `.app-glass-overlay` is what Liquid Glass light repaints near-white.
    expect(panel.classList.contains('app-glass-overlay')).toBe(false);
    expect(panel.className).toMatch(/\bbg-black\/\d+/);
  });

  it('shows the spinner while a playing stream is stalled, and drops it when it plays again', async () => {
    coarsePointer = true;
    const video = document.createElement('video');
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    state.video = video;
    await render(true);
    const spinner = () => document.querySelector('button[aria-label="Pause"] .lucide-loader-circle');
    expect(spinner()).toBeNull();

    await act(async () => { video.dispatchEvent(new Event('waiting')); });
    expect(spinner()).not.toBeNull();

    await act(async () => { video.dispatchEvent(new Event('playing')); });
    expect(spinner()).toBeNull();
  });

  it('covers the controls with the connect form, leaving Close reachable above it', async () => {
    coarsePointer = true;
    state.video = document.createElement('video');
    await render(true, { status: 'error', needsJellyfinConnect: true });
    const gate = [...document.querySelectorAll('[data-player-panel]')].find((el) => el.textContent?.includes('Connect your Jellyfin account')) as HTMLElement;
    expect(gate.className).toMatch(/(^|\s)bg-black(\s|$)/);
    expect(gate.className).toContain('z-20');
    // The form's inputs follow the theme; a light one typed black on black.
    expect(gate.className).toContain('text-white');
    expect(gate.className).toContain('[--foreground:#ffffff]');
    const topBar = (document.querySelector('button[aria-label="Close player"]') as HTMLElement).parentElement as HTMLElement;
    expect(topBar.className).toContain('z-30');
  });
});
