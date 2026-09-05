'use client';

import { useEffect, useRef, useState } from 'react';
import type { HelprrStreamInfo } from '@/types/jellyfin-streaming';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { getDeviceProfile } from '@/lib/jellyfin-playback/device-profile';
import { getJellyfinPlaybackDeviceId, getJellyfinPlaybackDeviceName, secondsToTicks, ticksToSeconds } from '@/lib/jellyfin-playback/device';
import { canPlayHlsWithMse, canPlayNativeHls, detectBrowser } from '@/lib/jellyfin-playback/browser';

/** Where in the runtime to sample from — far enough in to be past titles. */
const START_FRACTION = 0.22;
/** Never sample past this, so a long film doesn't open on its own ending. */
const MAX_START_SECONDS = 15 * 60;
/** How long a preview runs before the caller ducks back to artwork. */
export const PREVIEW_RUN_MS = 60_000;
/**
 * Deliberately modest. A preview is scenery, and a self-hosted server may have
 * to transcode to serve it — there is no reason to pull a 4K remux to fill a
 * hero that is a few hundred pixels tall.
 */
const PREVIEW_BITRATE = 6_000_000;

type PreviewState = 'idle' | 'playing' | 'failed';

/**
 * A muted clip of the title itself, sampled from the middle of the file.
 *
 * This exists because trailers do not cover the library: Jellyfin only carries
 * RemoteTrailers on movies, so every episode — which is all of Continue
 * Watching and Next Up — had nothing to play. Netflix's own previews are
 * clips of the title rather than trailers, and Helprr already has the file and
 * the streaming stack, so the clip is both more faithful and more complete.
 *
 * The cost is real and deliberately bounded: one preview at a time (the hero
 * or the open overlay, never a rail of them), a modest bitrate ceiling, and a
 * stop-encodings call on teardown so a transcode can never outlive the frame
 * that started it.
 */
export function useMediaPreview({
  itemId,
  runtimeTicks,
  enabled,
  videoRef,
}: {
  itemId: string | undefined;
  runtimeTicks: number | undefined;
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}): PreviewState {
  const [state, setState] = useState<PreviewState>('idle');
  /**
   * Scenery never competes with the thing the viewer actually asked to watch.
   *
   * The player is a fixed sheet over the route it started from, so the page
   * underneath stays mounted and its billboard kept previewing behind it — a
   * second transcode of, often, the very same 4K file, for a frame nobody can
   * see. The hero already stands down for the overlay and for a hovered card
   * for exactly this reason; playback is the stronger case.
   */
  const playerIdle = useJellyfinPlayback().status === 'idle';
  const active = enabled && playerIdle;
  const sessionRef = useRef<{ playSessionId: string; deviceId: string } | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  /**
   * The item this hook has already tried, successfully or not.
   *
   * Attach has to be idempotent per item. The first version re-ran whenever
   * any input churned, and because each run tore the previous one down mid-
   * flight, every attempt cancelled itself right after its response arrived:
   * the server saw a burst of playback requests and the element never got a
   * source. One attempt per item, and teardown owned by a separate effect,
   * removes the race entirely.
   */
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !itemId || attemptedRef.current === itemId) return;
    const el = videoRef.current;
    if (!el) return;
    attemptedRef.current = itemId;

    const runtimeSeconds = ticksToSeconds(runtimeTicks);
    const startSeconds = runtimeSeconds > 60
      ? Math.min(runtimeSeconds * START_FRACTION, MAX_START_SECONDS)
      : 0;

    const fail = () => setState('failed');

    void (async () => {
      try {
        const deviceId = getJellyfinPlaybackDeviceId();
        const response = await fetch('/api/jellyfin/stream/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId,
            deviceId,
            deviceName: getJellyfinPlaybackDeviceName(),
            startTimeTicks: secondsToTicks(startSeconds),
            maxStreamingBitrate: PREVIEW_BITRATE,
            // A preview never shows subtitles; asking for none also keeps the
            // server off the burn-in transcode path.
            subtitleStreamIndex: -1,
            // The profile is left at its defaults on purpose. Building it
            // around the preview's low ceiling made Jellyfin reject the
            // session outright ("Failed to start playback"); the ceiling
            // belongs on the request, where the server applies it to an
            // otherwise-valid profile.
            deviceProfile: getDeviceProfile(),
          }),
        });
        if (!response.ok) return fail();
        const info = (await response.json()) as HelprrStreamInfo;
        // The element may have been unmounted while the request was in flight.
        if (attemptedRef.current !== itemId || !videoRef.current) return;
        sessionRef.current = { playSessionId: info.playSessionId, deviceId };

        const browser = detectBrowser();
        const isHls = info.mimeType.toLowerCase().includes('mpegurl') || info.mediaUrl.includes('.m3u8');
        const useNative = isHls && canPlayNativeHls(el, browser)
          && (browser.iOS || (browser.safari && !canPlayHlsWithMse()));

        el.muted = true;
        el.playsInline = true;
        el.addEventListener('playing', () => setState('playing'), { once: true });
        el.addEventListener('error', fail, { once: true });

        if (isHls && !useNative && canPlayHlsWithMse()) {
          const Hls = (await import('hls.js')).default;
          if (attemptedRef.current !== itemId) return;
          if (Hls.isSupported()) {
            const instance = new Hls({ enableWorker: true });
            hlsRef.current = instance;
            instance.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal) fail();
            });
            instance.loadSource(info.mediaUrl);
            instance.attachMedia(el);
          } else {
            el.src = info.mediaUrl;
          }
        } else {
          el.src = info.mediaUrl;
        }

        /**
         * Only a transcode is cut at the offset that was asked for.
         *
         * A direct play or a direct stream serves the whole file and ignores
         * `startTimeTicks`, so the element has to be moved into place — and
         * that includes HLS, which the old check excluded. A remuxed MKV
         * direct-streams as HLS, which is most of this library and is always
         * the native path on iOS, so previews there opened on the intro and
         * the sponsor card: exactly the "starts from the beginning" the owner
         * reported. An HLS source cannot be seeked until its manifest has been
         * read, hence the wait for metadata.
         */
        if (info.playMethod !== 'Transcode' && startSeconds > 0) {
          const seekIntoPlace = () => {
            if (el.currentTime < startSeconds - 5) el.currentTime = startSeconds;
          };
          if (el.readyState >= 1) seekIntoPlace();
          else el.addEventListener('loadedmetadata', seekIntoPlace, { once: true });
        }

        await el.play().catch(fail);
      } catch {
        fail();
      }
    })();
  }, [active, itemId, runtimeTicks, videoRef]);

  /**
   * Teardown is its own effect so that attach stays idempotent, but it has to
   * follow `active` as well as the item: with the item alone, disabling a
   * preview (the home hero while an overlay is open, or anything at all once
   * the player takes over) left the element playing and the transcode running
   * behind an opacity-0 layer.
   *
   * It releases rather than merely pausing. A paused HLS transcode still holds
   * an encoder on the server, and a self-hosted box should not be paying for a
   * hero nobody can see; the cost is a fresh session when it comes back.
   */
  useEffect(() => {
    const el = videoRef.current;
    return () => {
      attemptedRef.current = null;
      setState('idle');
      hlsRef.current?.destroy();
      hlsRef.current = null;
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      // Release the server's encoder. Without this a transcode outlives every
      // hero the viewer merely scrolled past.
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) {
        void fetch('/api/jellyfin/stream/stop-encodings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...session, deviceName: getJellyfinPlaybackDeviceName() }),
          keepalive: true,
        }).catch(() => undefined);
      }
    };
  }, [itemId, active, videoRef]);

  return state;
}
