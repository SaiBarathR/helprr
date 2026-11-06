// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from '@/lib/store';

const state = vi.hoisted(() => ({ playback: {} as Record<string, unknown>, coarse: true }));
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
const storeDefaults = useUIStore.getState();

function playback(overrides: Record<string, unknown> = {}) {
  const previous = state.playback;
  state.playback = {
    item: { Id: 'ep1', Name: 'Pilot', Type: 'Episode', MediaType: 'Video' },
    stream: null, status: 'playing', error: null, needsJellyfinConnect: false,
    positionSeconds: 10, durationSeconds: 100, playbackRate: 1, volume: 0.5, muted: false,
    repeat: 'off', shuffled: false, queue: [], queueOpen: false, index: 0,
    segments: [], subtitleStreamIndex: null, audioStreamIndex: null, subtitleOffsetSeconds: 0,
    maxBitrate: null, effectiveMaxBitrate: null, videoExpanded: true,
    ...Object.fromEntries([
      'togglePause', 'skip', 'seek', 'setVolume', 'setMuted', 'next', 'previous', 'stop', 'setVideoExpanded',
      'setQueueOpen', 'setRepeat', 'toggleShuffle', 'setPlaybackRate', 'setMaxBitrate', 'setAudioStream',
      'setSubtitleStream', 'setSubtitleOffset', 'skipSegment', 'retryAfterConnect', 'reportChromeObstruction',
      'playQueueIndex',
    ].map((name) => [name, previous[name] ?? vi.fn()])),
    ...overrides,
  };
}

const render = (overrides: Record<string, unknown> = {}) => {
  playback(overrides);
  return act(async () => root.render(
    <QueryClientProvider client={client}><VideoStage mediaContainer={mediaContainer} /></QueryClientProvider>,
  ));
};
const spy = (name: string) => state.playback[name] as ReturnType<typeof vi.fn>;
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const allByLabel = (label: string) => document.querySelectorAll(`[aria-label="${label}"]`);
const surface = () => document.querySelector<HTMLElement>('div.touch-manipulation')!;
const chromeUp = () => byLabel('Minimize player') !== null;

function pointer(type: string, pointerType: string, clientX: number, target: HTMLElement) {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 300 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
}

/**
 * A tap on the bare video at a fraction of its width (the surface is 300px
 * wide here): pointerdown, pointerup, then the browser's click.
 */
async function tap(fraction: number, pointerType = 'touch', target: HTMLElement = surface()) {
  await act(async () => {
    pointer('pointerdown', pointerType, fraction * 300, target);
    pointer('pointerup', pointerType, fraction * 300, target);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: fraction * 300 }));
  });
}
const click = (element: HTMLElement | null) => act(async () => { element!.click(); });

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.coarse = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)' ? state.coarse : false,
    media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 300, bottom: 600, width: 300, height: 600, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  state.playback = {};
  useUIStore.setState(storeDefaults, true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a tap on the video', () => {
  it('with a finger shows and hides the controls and never pauses', async () => {
    await render();
    expect(chromeUp()).toBe(true);

    await tap(0.5);
    expect(chromeUp()).toBe(false);
    await tap(0.5);
    expect(chromeUp()).toBe(true);
    await tap(0.5);

    expect(spy('togglePause')).not.toHaveBeenCalled();
  });

  it('of unknown pointer type is treated as a finger, not a mouse', async () => {
    // Injected input (and some styluses) reports pointerType ''.
    await render();

    await tap(0.5, '');

    expect(chromeUp()).toBe(false);
    expect(spy('togglePause')).not.toHaveBeenCalled();
  });

  it('with a mouse still pauses while the controls are up', async () => {
    state.coarse = false;
    await render();

    await tap(0.5, 'mouse');

    expect(spy('togglePause')).toHaveBeenCalledTimes(1);
  });
});

describe('double-tap to skip', () => {
  it('skips by the chosen lengths on the outer thirds, adding a step per further tap', async () => {
    useUIStore.getState().setPlayerSkipForwardSeconds(15);
    useUIStore.getState().setPlayerSkipBackSeconds(5);
    await render();

    await tap(0.9);
    await tap(0.9);
    await tap(0.9);
    expect(spy('skip').mock.calls).toEqual([[15], [15]]);
    expect(document.body.textContent).toContain('+30 s');
    // The first tap of the pair hid the controls; the double-tap put them back.
    expect(chromeUp()).toBe(true);

    await tap(0.1);
    await tap(0.1);
    expect(spy('skip').mock.calls.at(-1)).toEqual([-5]);
    expect(spy('togglePause')).not.toHaveBeenCalled();
  });

  it('reads iOS Safari\'s double tap (two touches, one click) as one skip', async () => {
    await render();

    await act(async () => {
      for (const type of ['pointerdown', 'pointerup', 'pointerdown', 'pointerup']) pointer(type, 'touch', 270, surface());
      surface().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 270 }));
    });

    expect(spy('skip').mock.calls).toEqual([[10]]);
    expect(chromeUp()).toBe(true);
    expect(spy('togglePause')).not.toHaveBeenCalled();
  });

  it('does not let the click after a revealing tap press the button drawn under the finger', async () => {
    await render();
    await tap(0.5); // hides the controls
    expect(chromeUp()).toBe(false);

    // The tap that brings them back; iOS then sends its click to whatever is
    // under the finger now, which is the centre Pause button.
    await act(async () => {
      pointer('pointerdown', 'touch', 150, surface());
      pointer('pointerup', 'touch', 150, surface());
    });
    expect(chromeUp()).toBe(true);
    await click(byLabel('Pause'));

    expect(spy('togglePause')).not.toHaveBeenCalled();
  });

  it('still lets a quick real press of a control through right after a revealing tap', async () => {
    await render();
    await tap(0.5); // hides
    await tap(0.5); // reveals

    await act(async () => {
      pointer('pointerdown', 'touch', 150, byLabel('Pause')!);
      pointer('pointerup', 'touch', 150, byLabel('Pause')!);
      byLabel('Pause')!.click();
    });

    expect(spy('togglePause')).toHaveBeenCalledTimes(1);
  });

  it('ignores a drag across the video', async () => {
    await render();

    await act(async () => {
      pointer('pointerdown', 'touch', 50, surface());
      pointer('pointerup', 'touch', 250, surface());
    });

    expect(chromeUp()).toBe(true);
  });

  it('does nothing in the middle third', async () => {
    await render();

    await tap(0.5);
    await tap(0.5);

    expect(spy('skip')).not.toHaveBeenCalled();
  });

  it('is off for a live broadcast', async () => {
    await render({ item: { Id: 'tv', Name: 'News', Type: 'TvChannel', MediaType: 'Video' } });

    await tap(0.9);
    await tap(0.9);

    expect(spy('skip')).not.toHaveBeenCalled();
  });
});

describe('the centre transport', () => {
  it('replaces the bottom row transport on a touch screen', async () => {
    await render();

    expect(allByLabel('Back 10 seconds')).toHaveLength(1);
    expect(allByLabel('Forward 10 seconds')).toHaveLength(1);
    expect(allByLabel('Pause')).toHaveLength(1);
    await click(byLabel('Forward 10 seconds'));
    await click(byLabel('Pause'));

    expect(spy('skip')).toHaveBeenCalledWith(10);
    expect(spy('togglePause')).toHaveBeenCalledTimes(1);
  });

  it('is not drawn with a mouse, where the bottom row keeps its buttons', async () => {
    state.coarse = false;
    await render();

    expect(allByLabel('Back 10 seconds')).toHaveLength(1);
    expect(document.querySelector('.size-16')).toBeNull();
  });

  it('shows a spinner in place of play while the stream loads', async () => {
    await render({ status: 'loading' });

    expect(document.querySelector('.animate-spin')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Loading stream');
  });
});

describe('the skip length setting', () => {
  it('is used by the buttons and the arrow keys', async () => {
    useUIStore.getState().setPlayerSkipBackSeconds(30);
    useUIStore.getState().setPlayerSkipForwardSeconds(45);
    await render();

    expect(byLabel('Back 30 seconds')).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
    });

    expect(spy('skip').mock.calls).toEqual([[45], [-30]]);
  });
});

describe('the screen lock', () => {
  it('swallows every tap until unlocked', async () => {
    await render();
    await click(byLabel('Lock screen'));
    expect(chromeUp()).toBe(false);
    // Focus moves to the way out rather than falling to <body>.
    expect(document.activeElement).toBe(byLabel('Unlock screen'));

    const shield = document.querySelector<HTMLElement>('.z-30')!;
    await tap(0.9, 'touch', shield);
    await tap(0.9, 'touch', shield);
    expect(spy('skip')).not.toHaveBeenCalled();
    expect(spy('togglePause')).not.toHaveBeenCalled();
    expect(chromeUp()).toBe(false);

    await click(byLabel('Unlock screen'));
    expect(chromeUp()).toBe(true);
  });

  it('is offered only on a touch screen', async () => {
    state.coarse = false;
    await render();

    expect(byLabel('Lock screen')).toBeNull();
  });
});

describe('the control row', () => {
  it('has Next episode when the queue has one', async () => {
    const queue = [
      { Id: 'ep1', Name: 'Pilot', Type: 'Episode', MediaType: 'Video' },
      { Id: 'ep2', Name: 'Two', Type: 'Episode', MediaType: 'Video' },
    ];
    await render({ queue, index: 0 });
    await click(byLabel('Next episode'));
    expect(spy('next')).toHaveBeenCalledTimes(1);

    await render({ queue, index: 1 });
    expect(byLabel('Next episode')).toBeNull();
  });
});

describe('the audio and subtitles panel', () => {
  const stream = (audioCount: number) => ({
    item: { Id: 'ep1' },
    mediaSource: {
      Id: 'src',
      MediaStreams: [
        ...Array.from({ length: audioCount }, (_, index) => ({ Type: 'Audio', Index: index + 1, DisplayTitle: `Audio track ${index + 1}` })),
        { Type: 'Subtitle', Index: 9, DisplayTitle: 'English' },
      ],
    },
    subtitleTracks: [],
  });

  it('lists the audio tracks above the subtitles when there is a choice', async () => {
    await render({ stream: stream(2), audioStreamIndex: 1 });
    await click(byLabel('Audio and subtitles'));

    const text = document.querySelector('[data-player-panel]')!.textContent!;
    expect(text.indexOf('Audio track 2')).toBeGreaterThan(-1);
    expect(text.indexOf('Audio track 2')).toBeLessThan(text.indexOf('English'));
    await click([...document.querySelectorAll<HTMLElement>('[data-player-panel] button')].find((b) => b.textContent === 'Audio track 2')!);
    expect(spy('setAudioStream')).toHaveBeenCalledWith(2);
  });

  it('is just Subtitles with a single audio track', async () => {
    await render({ stream: stream(1) });

    expect(byLabel('Audio and subtitles')).toBeNull();
    await click(byLabel('Subtitles'));
    expect(document.querySelector('[data-player-panel]')!.textContent).not.toContain('Audio track 1');
  });
});
