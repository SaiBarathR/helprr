'use client';

import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { FadeInImage } from '@/components/media/fade-in-image';
import { PREVIEW_RUN_MS, useMediaPreview } from '@/components/jellyfin-streaming/cinematic/media-preview';
import {
  loadYouTubeIframeApi,
  targetTrailerHeight,
  targetTrailerQuality,
  trailerPlayerLayout,
  youtubeTrailerKey,
} from '@/lib/jellyfin-playback/youtube-embed';
import { useUIStore } from '@/lib/store';
import { cn } from '@/lib/utils';

/** How long the artwork holds before a preview is attempted. */
const START_DELAY_MS = 1600;
/** How long to wait for the trailer player to reach PLAYING before giving up. */
const TRAILER_TIMEOUT_MS = 8000;

type Phase = 'art' | 'media' | 'trailer';

/**
 * Hero artwork that hands over to a muted preview, then ducks back.
 *
 * Two sources, in order. A clip of the title itself comes first because it is
 * both what Netflix actually shows and the only option that covers the whole
 * library — Jellyfin carries RemoteTrailers on movies only, so every episode
 * (all of Continue Watching and Next Up) had nothing to play. A YouTube
 * trailer is the fallback for anything the media path can't serve.
 *
 * Every failure is silent by construction: the preview layers sit at opacity 0
 * until their player reports it is genuinely playing, so an unembeddable
 * trailer, a blocked autoplay policy, a missing file or a stalled transcode
 * all just leave the artwork up.
 */
export function PreviewBackdrop({
  backdropUrl,
  itemId,
  runtimeTicks,
  trailerUrl,
  enabled,
  paused = false,
  priority = false,
  className,
  controlsClassName,
}: {
  backdropUrl: string | null;
  /** Item to sample the clip from. Omit to use the trailer path only. */
  itemId?: string;
  runtimeTicks?: number;
  trailerUrl?: string;
  /** Off for the classic skin, which shows still artwork only. */
  enabled: boolean;
  /** Suspends playback — the home hero pauses while an overlay is open. */
  paused?: boolean;
  priority?: boolean;
  className?: string;
  /** Where the mute toggle sits; the caller knows its own layout. */
  controlsClassName?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  /**
   * Sized by us, and separate from the mount point below: YT.Player *replaces*
   * the element it is handed, so styling that element writes to a detached
   * node and leaves the player at its default 640x360.
   */
  const sizerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YT.Player | null>(null);

  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Opt-out lives in Settings → Appearance → Watch: a preview can cost the
  // server a transcode, which is the owner's call on their own hardware.
  const previewsAllowed = useUIStore((s) => s.watchPreviews);
  const active = enabled && previewsAllowed && !paused && !reducedMotion;
  const videoKey = active ? youtubeTrailerKey(trailerUrl) : null;

  // Hold the artwork briefly before spending anything on a preview.
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setTimeout(() => setArmed(true), START_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      setArmed(false);
    };
  }, [active]);

  const mediaState = useMediaPreview({
    itemId,
    runtimeTicks,
    enabled: active && armed && !trailerPlaying,
    videoRef,
  });

  // Trailer is the fallback, attempted only once the media path has failed.
  const tryTrailer = active && armed && mediaState === 'failed' && Boolean(videoKey);

  /**
   * Derived rather than stored. Every source reports asynchronously, so a
   * `phase` state would need an effect per source just to mirror them back —
   * which is the cascading-render shape React warns about.
   */
  const phase: Phase = !active || !armed
    ? 'art'
    : trailerPlaying
      ? 'trailer'
      : mediaState === 'playing'
        ? 'media'
        : 'art';

  useEffect(() => {
    if (!tryTrailer || !videoKey) return undefined;

    let cancelled = false;
    const timers: number[] = [];
    let startWatchdog: number | undefined;
    let player: YT.Player | null = null;

    const giveUp = () => { if (!cancelled) setTrailerPlaying(false); };

    void loadYouTubeIframeApi()
      .then((api) => {
        if (cancelled || !hostRef.current) return;
        // Cleared once playback starts, or it cuts every trailer off at the
        // timeout no matter how well it is playing.
        startWatchdog = window.setTimeout(giveUp, TRAILER_TIMEOUT_MS);
        timers.push(startWatchdog);

        player = new api.Player(hostRef.current, {
          videoId: videoKey,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1, mute: 1, controls: 0, disablekb: 1,
            modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3,
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
                event.target.setPlaybackQuality(targetTrailerQuality(window.innerWidth));
                setTrailerPlaying(true);
              }
              if (event.data === 0) giveUp();
            },
            onError: giveUp,
          },
        });
        playerRef.current = player;
      })
      .catch(giveUp);

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      playerRef.current = null;
      setTrailerPlaying(false);
      try { player?.destroy(); } catch { /* the API may have torn it down first */ }
    };
  }, [tryTrailer, videoKey]);

  // One run, then back to artwork, whichever source ended up playing.
  useEffect(() => {
    if (phase === 'art') return undefined;
    const timer = window.setTimeout(() => setArmed(false), PREVIEW_RUN_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // Lay the trailer player out at the rendition we want and scale it back to a
  // cover fit. The <video> path needs none of this — object-fit does it.
  useEffect(() => {
    const frame = frameRef.current;
    const sizer = sizerRef.current;
    if (!frame || !sizer || phase !== 'trailer') return undefined;

    let raf = 0;
    const apply = () => {
      const { width, height } = frame.getBoundingClientRect();
      // A zero measurement means layout has not settled; writing it would
      // strand the player at 0 and the observer may never fire again, since
      // the frame's own size never changes. Retry on the next frame instead.
      if (width <= 0 || height <= 0) {
        raf = window.requestAnimationFrame(apply);
        return;
      }
      const layout = trailerPlayerLayout(width, height, targetTrailerHeight(window.innerWidth));
      sizer.style.width = `${layout.width}px`;
      sizer.style.height = `${layout.height}px`;
      sizer.style.transform = `translate(-50%, -50%) scale(${layout.scale})`;
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(frame);
    window.addEventListener('resize', apply);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [phase]);

  const toggleMute = () => {
    setMuted((current) => {
      const next = !current;
      if (phase === 'media' && videoRef.current) videoRef.current.muted = next;
      if (phase === 'trailer' && playerRef.current) {
        if (next) playerRef.current.mute();
        else playerRef.current.unMute();
      }
      return next;
    });
  };

  const showPreview = phase !== 'art';

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
            showPreview ? 'opacity-0' : 'opacity-100',
            className,
          )}
        />
      )}

      {/* Always mounted so the player has somewhere to attach; revealed only
          once it reports playing. */}
      <video
        ref={videoRef}
        muted
        playsInline
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-700',
          phase === 'media' ? 'opacity-100' : 'opacity-0',
        )}
      />

      {videoKey && (
        <span
          aria-hidden={phase !== 'trailer'}
          className={cn(
            'pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-700',
            phase === 'trailer' ? 'opacity-100' : 'opacity-0',
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

      {showPreview && (
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute preview' : 'Mute preview'}
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
