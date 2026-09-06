/**
 * A running `JellyfinPlaybackProvider`, for the behaviour that only appears
 * once a restart is actually in flight.
 *
 * Three defects have now landed in the same window — the transient
 * `currentTime` zero, a paused title resuming on a track change, and the same
 * resume again when a second change arrived mid-attach. All three live in
 * `restartWith`, which closes over the provider's refs and so cannot be reached
 * by the pure-helper tests the rest of this folder uses.
 *
 * The provider is rendered with React's own `createRoot`, so this needs no
 * testing-library dependency. `attachMedia` reaches hls.js and libass only
 * through dynamic imports gated on the stream being HLS or needing a burned-in
 * subtitle, so a DirectPlay MP4 with no subtitle tracks stays on the plain
 * `el.src` path and neither is ever loaded.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import {
  JellyfinPlaybackProvider,
  useJellyfinMediaRef,
  useJellyfinPlayback,
} from '@/components/jellyfin-streaming/playback-provider';
import type { JellyfinItem } from '@/types/jellyfin';
import type { HelprrStreamInfo } from '@/types/jellyfin-streaming';

type Playback = ReturnType<typeof useJellyfinPlayback>;

/** What `/api/jellyfin/stream/info` was asked for, in call order. */
export interface StreamRequest {
  itemId: string;
  audioStreamIndex?: number | null;
  startTimeTicks?: number;
}

/** A session report the provider sent, in call order. */
export interface SessionReport {
  event: string;
  isPaused: boolean;
  positionTicks: number;
}

export const ITEM: JellyfinItem = {
  Id: 'item-1',
  Name: 'Test Episode',
  Type: 'Episode',
  MediaType: 'Video',
  RunTimeTicks: 25 * 60 * 10_000_000,
} as JellyfinItem;

/**
 * The media element jsdom does not provide.
 *
 * `play()` clearing `paused` is the whole point: it is what `attachMedia` does
 * to every restart, and what made reading `el.paused` in `restartWith` wrong.
 */
export interface FakeMedia {
  paused: () => boolean;
  currentTime: () => number;
}

export interface Harness {
  playback: () => Playback;
  media: FakeMedia;
  /** Stream requests the provider made, oldest first. */
  requests: StreamRequest[];
  /** Session reports the provider sent, oldest first. */
  reports: SessionReport[];
  /** Handlers the provider registered on the Media Session. */
  mediaSession: Record<string, () => void>;
  /** The `<video>` the provider is driving. */
  element: () => HTMLVideoElement;
  /**
   * Hold `/api/jellyfin/stream/info` so a restart can be caught in flight, the
   * window in which the element is playing but the viewer's intent is not.
   */
  holdStreamInfo: () => void;
  releaseStreamInfo: () => void;
  act: (fn: () => void | Promise<void>) => Promise<void>;
  cleanup: () => void;
}

function installMediaElement(state: { paused: boolean; currentTime: number }) {
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(proto, 'paused', { configurable: true, get: () => state.paused });
  Object.defineProperty(proto, 'duration', { configurable: true, get: () => 1500 });
  Object.defineProperty(proto, 'readyState', { configurable: true, get: () => 4 });
  Object.defineProperty(proto, 'currentTime', {
    configurable: true,
    get: () => state.currentTime,
    set(value: number) { state.currentTime = value; },
  });
  proto.canPlayType = () => '';
  proto.load = () => {};
  proto.play = function play(this: HTMLMediaElement) {
    state.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  };
  proto.pause = function pause(this: HTMLMediaElement) {
    state.paused = true;
    this.dispatchEvent(new Event('pause'));
  };
}

/**
 * Mount a provider wired to a fake element and a stubbed API.
 *
 * Every `/api/jellyfin/stream/info` call is recorded, so a test can see which
 * audio index each restart actually asked Jellyfin for, and every session
 * report is recorded, so it can see the `isPaused` each start announced.
 */
export async function mountPlayback(): Promise<Harness> {
  const state = { paused: true, currentTime: 0 };
  installMediaElement(state);

  const requests: StreamRequest[] = [];
  const reports: SessionReport[] = [];
  const mediaSession: Record<string, () => void> = {};

  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: {
      metadata: null,
      playbackState: 'none',
      setActionHandler: (action: string, handler: () => void) => { mediaSession[action] = handler; },
    },
  });
  // The provider constructs one for the lock screen; jsdom has no such global.
  (globalThis as unknown as Record<string, unknown>).MediaMetadata = class {};

  let session = 0;
  let gate: Promise<void> | null = null;
  let openGate: (() => void) | null = null;

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const ok = (payload: unknown) => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    if (url.includes('/api/jellyfin/stream/info')) {
      if (gate) await gate;
      session += 1;
      requests.push({
        itemId: body.itemId,
        audioStreamIndex: body.audioStreamIndex ?? null,
        startTimeTicks: body.startTimeTicks,
      });
      const stream: HelprrStreamInfo = {
        item: ITEM,
        // Enough of a media source for the provider; the indexes are what the
        // restart carries and the tests assert on.
        mediaSource: { Id: 'source-1', RunTimeTicks: ITEM.RunTimeTicks, MediaStreams: [] } as never,
        playMethod: 'DirectPlay',
        playSessionId: `session-${session}`,
        // Not `.m3u8` and not an mpegurl mime type, so `attachMedia` stays off
        // the hls.js path entirely.
        mediaUrl: 'https://example.invalid/stream.mp4',
        mimeType: 'video/mp4',
        startTimeTicks: body.startTimeTicks ?? 0,
        transcodingOffsetTicks: 0,
        subtitleTracks: [],
      };
      return ok(stream);
    }
    if (url.includes('/api/jellyfin/stream/session')) {
      reports.push({ event: body.event, isPaused: Boolean(body.isPaused), positionTicks: body.positionTicks ?? 0 });
      return ok({});
    }
    if (url.includes('/api/account/jellyfin/link')) return ok({ linked: true });
    return ok({});
  }));

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  // Published from an effect, not during render: reassigning a captured
  // variable mid-render is a side effect React's lint rule rightly rejects.
  const holder: { current: Playback | null } = { current: null };
  function Probe() {
    const playback = useJellyfinPlayback();
    const mediaRef = useJellyfinMediaRef();
    useEffect(() => { holder.current = playback; });
    return <video ref={mediaRef} />;
  }

  const run = async (fn: () => void | Promise<void>) => {
    await act(async () => { await fn(); });
  };

  await run(() => {
    root.render(<JellyfinPlaybackProvider><Probe /></JellyfinPlaybackProvider>);
  });

  return {
    playback: () => {
      if (!holder.current) throw new Error('provider did not mount');
      return holder.current;
    },
    media: { paused: () => state.paused, currentTime: () => state.currentTime },
    requests,
    reports,
    mediaSession,
    element: () => {
      const el = container.querySelector('video');
      if (!el) throw new Error('no media element');
      return el;
    },
    holdStreamInfo: () => { gate = new Promise<void>((resolve) => { openGate = resolve; }); },
    releaseStreamInfo: () => { openGate?.(); gate = null; openGate = null; },
    act: run,
    cleanup: () => {
      act(() => { root.unmount(); });
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}
