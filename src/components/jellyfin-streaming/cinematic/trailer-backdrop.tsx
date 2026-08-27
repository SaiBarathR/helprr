'use client';

import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { FadeInImage } from '@/components/media/fade-in-image';
import {
  loadYouTubeIframeApi,
  targetTrailerHeight,
  targetTrailerQuality,
  trailerPlayerLayout,
  youtubeTrailerKey,
} from '@/lib/jellyfin-playback/youtube-embed';
import { cn } from '@/lib/utils';

/** How long the artwork holds before the trailer is cued. */
const TRAILER_DELAY_MS = 2000;
/**
 * How long to wait for the player to actually reach PLAYING before giving up
 * and staying on artwork. Covers blocked autoplay, a dead network, and videos
 * that cue but never start.
 */
const START_TIMEOUT_MS = 8000;
/** Ceiling on a single trailer run; ENDED normally gets there first. */
const MAX_RUN_MS = 90_000;

type Phase = 'art' | 'playing';

/**
 * Hero artwork that hands over to a muted trailer once the player confirms it
 * is really playing.
 *
 * The confirmation is the point. A plain autoplay iframe cannot be supervised,
 * so it failed loudly: unembeddable videos showed the provider's "video
 * unavailable" card, blocked autoplay left dead paused chrome over a black
 * frame, and a small player element was served a soft low rendition. Driving a
 * real player means each of those failures now simply stays on the artwork,
 * and the rendition can be asked for explicitly.
 *
 * Only YouTube trailers autoplay. Jellyfin's other trailer host has no
 * comparable API, and an unsupervised embed is precisely what this replaced.
 */
export function TrailerBackdrop({
  backdropUrl,
  trailerUrl,
  enabled,
  priority = false,
  className,
  controlsClassName,
}: {
  backdropUrl: string | null;
  trailerUrl?: string;
  /** Off for the classic skin, which shows still artwork only. */
  enabled: boolean;
  priority?: boolean;
  className?: string;
  /** Where the mute toggle sits; the caller knows its own layout. */
  controlsClassName?: string;
}) {
  const [phase, setPhase] = useState<Phase>('art');
  const [muted, setMuted] = useState(true);
  const frameRef = useRef<HTMLDivElement | null>(null);
  /**
   * Sized and positioned by us. It has to be separate from the mount point
   * below, because YT.Player *replaces* the element it is handed with its own
   * iframe — styling that element directly writes to a detached node, which
   * left the player at YouTube's default 640x360 in the middle of the hero.
   */
  const sizerRef = useRef<HTMLDivElement | null>(null);
  /** Sacrificial mount point; the API swaps this out for the iframe. */
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YT.Player | null>(null);

  const videoKey = enabled ? youtubeTrailerKey(trailerUrl) : null;

  useEffect(() => {
    if (!videoKey) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let cancelled = false;
    const timers: number[] = [];
    /** Cleared the moment playback starts; see the PLAYING branch below. */
    let startWatchdog: number | undefined;
    let player: YT.Player | null = null;

    const giveUp = () => {
      if (cancelled) return;
      setPhase('art');
    };

    timers.push(window.setTimeout(() => {
      void loadYouTubeIframeApi()
        .then((api) => {
          if (cancelled || !hostRef.current) return;

          // Watchdog: anything that stops the player reaching PLAYING — a
          // blocked autoplay policy, an unembeddable video whose error event
          // never arrives, a stalled network — falls back to artwork. It MUST
          // be cleared once playback starts, or it cuts every trailer off at
          // START_TIMEOUT_MS regardless of how well it is playing.
          startWatchdog = window.setTimeout(giveUp, START_TIMEOUT_MS);
          timers.push(startWatchdog);

          player = new api.Player(hostRef.current, {
            videoId: videoKey,
            // Fill the sizer rather than YouTube's default 640x360 box.
            width: '100%',
            height: '100%',
            playerVars: {
              autoplay: 1,
              mute: 1,
              controls: 0,
              disablekb: 1,
              modestbranding: 1,
              rel: 0,
              playsinline: 1,
              // No annotations or related-video overlays on a backdrop.
              iv_load_policy: 3,
            },
            events: {
              onReady: (event) => {
                if (cancelled) return;
                event.target.mute();
                event.target.setPlaybackQuality(targetTrailerQuality(window.innerWidth));
                event.target.playVideo();
              },
              onStateChange: (event) => {
                if (cancelled) return;
                if (event.data === 1) {
                  if (startWatchdog !== undefined) {
                    window.clearTimeout(startWatchdog);
                    startWatchdog = undefined;
                  }
                  // Ask again once playback is under way: the player settles
                  // on its own rendition when it starts.
                  event.target.setPlaybackQuality(targetTrailerQuality(window.innerWidth));
                  setPhase('playing');
                  timers.push(window.setTimeout(giveUp, MAX_RUN_MS));
                }
                if (event.data === 0) giveUp();
              },
              // Removed, private, or embedding disabled — the exact cases that
              // used to render a "video unavailable" card over the hero.
              onError: giveUp,
            },
          });
          playerRef.current = player;
        })
        .catch(giveUp);
    }, TRAILER_DELAY_MS));

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      playerRef.current = null;
      // destroy() throws if the API tore its iframe down first; the frame is
      // being unmounted either way.
      try {
        player?.destroy();
      } catch {
        // no-op
      }
    };
  }, [videoKey]);

  // Lay the player out at the rendition we want and scale it back to a cover
  // fit. Re-measured on resize, so rotating a tablet re-picks the quality tier.
  useEffect(() => {
    const frame = frameRef.current;
    const sizer = sizerRef.current;
    if (!frame || !sizer || phase !== 'playing') return undefined;

    const apply = () => {
      const { width, height } = frame.getBoundingClientRect();
      const layout = trailerPlayerLayout(width, height, targetTrailerHeight(window.innerWidth));
      sizer.style.width = `${layout.width}px`;
      sizer.style.height = `${layout.height}px`;
      sizer.style.transform = `translate(-50%, -50%) scale(${layout.scale})`;
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [phase]);

  const showTrailer = phase === 'playing';

  return (
    <>
      {backdropUrl && (
        <FadeInImage
          src={backdropUrl}
          alt=""
          fill
          sizes="100vw"
          priority={priority}
          unoptimized
          className={cn(
            'object-cover transition-opacity duration-700',
            showTrailer ? 'opacity-0' : 'opacity-100',
            className,
          )}
        />
      )}

      {/* Mounted as soon as a key is known so the player has somewhere to
          build, but revealed only once PLAYING confirms there is something
          worth showing. pointer-events-none keeps the surface clickable
          rather than handing input to the iframe. */}
      {videoKey && (
        <span
          aria-hidden={!showTrailer}
          className={cn(
            'pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-700',
            showTrailer ? 'opacity-100' : 'opacity-0',
          )}
        >
          <span ref={frameRef} className="absolute inset-0 block">
            <div
              ref={sizerRef}
              className="absolute top-1/2 left-1/2 origin-center [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:border-0"
            >
              <div ref={hostRef} />
            </div>
          </span>
        </span>
      )}

      {showTrailer && (
        <button
          type="button"
          onClick={() => {
            const player = playerRef.current;
            if (!player) return;
            // The API toggles audio in place — no iframe reload, so the
            // trailer keeps playing from where it is.
            setMuted((current) => {
              if (current) player.unMute();
              else player.mute();
              return !current;
            });
          }}
          aria-label={muted ? 'Unmute trailer' : 'Mute trailer'}
          className={cn(
            'z-20 flex size-9 items-center justify-center rounded-full border border-white/50 text-white transition-colors hover:border-white',
            controlsClassName,
          )}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      )}
    </>
  );
}
