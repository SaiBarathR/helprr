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

  it('hands focus to the mini player once Escape minimizes, not to <body>', async () => {
    const miniExpand = document.createElement('button');
    miniExpand.dataset.nowPlayingExpand = '';
    document.body.append(miniExpand);
    await render(true);
    const minimize = document.querySelector('button[aria-label="Minimize player"]') as HTMLButtonElement;
    minimize.focus();
    await press('Escape');
    expect(spy('setVideoExpanded')).toHaveBeenCalledWith(false);

    await render(false);
    expect(document.activeElement).toBe(miniExpand);
  });

  it('leaves focus alone when something took it on purpose', async () => {
    const miniExpand = document.createElement('button');
    miniExpand.dataset.nowPlayingExpand = '';
    const elsewhere = document.createElement('input');
    document.body.append(miniExpand, elsewhere);
    await render(true);
    elsewhere.focus();
    await render(false);
    expect(document.activeElement).toBe(elsewhere);
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

  it('leaves the arrow keys and Space to the choice list, Escape closes it and focus goes back to its button', async () => {
    state.video = document.createElement('video');
    const MediaStreams = [
      { Type: 'Audio', Index: 1, DisplayTitle: 'English' },
      { Type: 'Audio', Index: 2, DisplayTitle: 'Japanese' },
    ];
    await render(true, { stream: { mediaSource: { MediaStreams }, item: { Id: 'item1' }, subtitleTracks: [] }, audioStreamIndex: 1 });
    const opener = document.querySelector('button[aria-label="Audio and subtitles"]') as HTMLButtonElement;
    opener.focus();
    await act(async () => opener.click());
    const radio = document.querySelector('[role="radiogroup"][aria-label="Audio"] [role="radio"]') as HTMLElement;
    radio.focus();
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', ' ']) {
      await act(async () => { radio.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
    }
    expect(spy('setVolume')).not.toHaveBeenCalled();
    expect(spy('skip')).not.toHaveBeenCalled();
    expect(spy('togglePause')).not.toHaveBeenCalled();

    await act(async () => { radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(document.querySelector('[data-player-panel]')).toBeNull();
    expect(spy('setVideoExpanded')).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it('moves between rows with the arrow keys, Home and End, without picking, the tab stop following focus', async () => {
    state.video = document.createElement('video');
    const MediaStreams = [
      { Type: 'Audio', Index: 1, DisplayTitle: 'English' },
      { Type: 'Audio', Index: 2, DisplayTitle: 'Japanese' },
      { Type: 'Audio', Index: 3, DisplayTitle: 'Commentary' },
    ];
    await render(true, { stream: { mediaSource: { MediaStreams }, item: { Id: 'item1' }, subtitleTracks: [] }, audioStreamIndex: 3 });
    await act(async () => (document.querySelector('button[aria-label="Audio and subtitles"]') as HTMLButtonElement).click());
    const rows = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"][aria-label="Audio"] [role="radio"]')];
    const stops = () => rows.map((row) => row.tabIndex);
    expect(stops()).toEqual([-1, -1, 0]); // Commentary, picked
    const subtitleRows = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"][aria-label="Subtitles"] [role="radio"]')];
    expect(subtitleRows.map((row) => row.tabIndex)).toEqual([0]); // Off, picked

    const key = (target: HTMLElement, name: string) => act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    });
    await act(async () => rows[2].focus());
    await key(rows[2], 'ArrowUp');
    expect(document.activeElement).toBe(rows[1]);
    // Tab leaves from here: no later row of the group is still a tab stop.
    expect(stops()).toEqual([-1, 0, -1]);
    await key(rows[1], 'ArrowDown');
    await key(rows[2], 'ArrowDown'); // wraps
    expect(document.activeElement).toBe(rows[0]);
    await key(rows[0], 'ArrowUp'); // wraps back
    expect(document.activeElement).toBe(rows[2]);
    await key(rows[2], 'Home');
    expect(document.activeElement).toBe(rows[0]);
    await key(rows[0], 'End');
    expect(document.activeElement).toBe(rows[2]);
    await key(rows[2], 'ArrowLeft');
    expect(document.activeElement).toBe(rows[1]);
    expect(spy('setAudioStream')).not.toHaveBeenCalled();
    expect(spy('skip')).not.toHaveBeenCalled();
    // A re-render while focus is in the group keeps the stop on the focused row.
    await render(true, { stream: { mediaSource: { MediaStreams }, item: { Id: 'item1' }, subtitleTracks: [] }, audioStreamIndex: 3 });
    expect(stops()).toEqual([-1, 0, -1]);

    // Leaving the group puts the stop back on the picked row, for the next Tab in.
    await act(async () => subtitleRows[0].focus());
    expect(stops()).toEqual([-1, -1, 0]);

    // A pick moves the stop with it.
    await act(async () => rows[0].click());
    expect(spy('setAudioStream')).toHaveBeenCalledWith(1);
    await act(async () => subtitleRows[0].focus());
    await render(true, { stream: { mediaSource: { MediaStreams }, item: { Id: 'item1' }, subtitleTracks: [] }, audioStreamIndex: 1 });
    expect(stops()).toEqual([0, -1, -1]);
  });
});
