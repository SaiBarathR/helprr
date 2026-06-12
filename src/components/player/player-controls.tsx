'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Airplay,
  ChevronLeft,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
} from 'lucide-react';
import type { MediaSourceInfo } from '@/types/jellyfin-playback';
import { TrackMenus } from '@/components/player/track-menus';

const HIDE_DELAY_MS = 3000;
const DOUBLE_TAP_MS = 300;
const SKIP_SECONDS = 10;

// Safari-only extensions used for AirPlay and the iPhone native-player escape hatch.
interface WebKitVideoElement extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitEnterFullscreen?: () => void;
}

function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

function SeekBar({
  currentSeconds,
  durationSeconds,
  bufferedSeconds,
  onSeekTo,
  onDraggingChange,
}: {
  currentSeconds: number;
  durationSeconds: number;
  bufferedSeconds: number;
  onSeekTo: (seconds: number) => void;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const fractionFromEvent = useCallback((e: React.PointerEvent) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }, []);

  const playedFraction =
    dragFraction ?? (durationSeconds > 0 ? currentSeconds / durationSeconds : 0);
  const bufferedFraction = durationSeconds > 0 ? Math.min(1, bufferedSeconds / durationSeconds) : 0;

  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.floor(durationSeconds)}
      aria-valuenow={Math.floor(dragFraction !== null ? dragFraction * durationSeconds : currentSeconds)}
      aria-valuetext={formatTime(dragFraction !== null ? dragFraction * durationSeconds : currentSeconds)}
      className="group relative flex h-8 w-full cursor-pointer touch-none items-center"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragFraction(fractionFromEvent(e));
        onDraggingChange(true);
      }}
      onPointerMove={(e) => {
        if (dragFraction !== null) setDragFraction(fractionFromEvent(e));
      }}
      onPointerUp={(e) => {
        if (dragFraction !== null) {
          onSeekTo(fractionFromEvent(e) * durationSeconds);
          setDragFraction(null);
          onDraggingChange(false);
        }
      }}
      onPointerCancel={() => {
        setDragFraction(null);
        onDraggingChange(false);
      }}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover:h-1.5">
        <div
          className="absolute inset-y-0 left-0 bg-white/30"
          style={{ width: `${bufferedFraction * 100}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-primary"
          style={{ width: `${playedFraction * 100}%` }}
        />
      </div>
      <div
        className="absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-primary opacity-0 transition-opacity group-hover:opacity-100"
        style={{ left: `${playedFraction * 100}%`, opacity: dragFraction !== null ? 1 : undefined }}
      />
      {dragFraction !== null && (
        <div
          className="absolute bottom-7 -translate-x-1/2 rounded bg-black/90 px-2 py-0.5 font-mono text-xs text-white"
          style={{ left: `${dragFraction * 100}%` }}
        >
          {formatTime(dragFraction * durationSeconds)}
        </div>
      )}
    </div>
  );
}

export function PlayerControls({
  title,
  subtitle,
  playing,
  buffering,
  switching,
  currentSeconds,
  durationSeconds,
  bufferedSeconds,
  source,
  audioStreamIndex,
  subtitleStreamIndex,
  maxBitrate,
  videoEl,
  containerEl,
  onTogglePlay,
  onSeekTo,
  onSkip,
  onClose,
  onSelectAudio,
  onSelectSubtitle,
  onSelectQuality,
}: {
  title: string;
  subtitle?: string;
  playing: boolean;
  buffering: boolean;
  switching: boolean;
  currentSeconds: number;
  durationSeconds: number;
  bufferedSeconds: number;
  source: MediaSourceInfo | null;
  audioStreamIndex?: number;
  subtitleStreamIndex: number;
  maxBitrate: number | null;
  videoEl: HTMLVideoElement | null;
  containerEl: HTMLElement | null;
  onTogglePlay: () => void;
  onSeekTo: (seconds: number) => void;
  onSkip: (delta: number) => void;
  onClose: () => void;
  onSelectAudio: (index: number) => void;
  onSelectSubtitle: (index: number) => void;
  onSelectQuality: (bitrate: number | null) => void;
}) {
  const [visible, setVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef(0);

  // Keep the latest "may we auto-hide" inputs in a ref so the timer callback
  // doesn't capture stale state.
  const stateRef = useRef({ playing, settingsOpen, dragging });
  useEffect(() => {
    stateRef.current = { playing, settingsOpen, dragging };
  }, [playing, settingsOpen, dragging]);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      const { playing: p, settingsOpen: s, dragging: d } = stateRef.current;
      if (p && !s && !d) setVisible(false);
    }, HIDE_DELAY_MS);
  }, []);

  const show = useCallback(() => {
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    // Resuming restarts the auto-hide clock.
    if (playing) scheduleHide();
  }, [playing, scheduleHide]);

  // Paused playback, an open menu, or an in-flight scrub pins the controls.
  const shown = visible || !playing || settingsOpen || dragging;

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    };
  }, []);

  // Single tap toggles the controls (after a beat, so it can be cancelled);
  // double tap on the side thirds skips, in the middle toggles play.
  const handleSurfaceTap = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return; // taps on buttons/bars handle themselves
      const now = Date.now();
      const rect = e.currentTarget.getBoundingClientRect();
      const zone = (e.clientX - rect.left) / rect.width;

      if (now - lastTapRef.current < DOUBLE_TAP_MS) {
        lastTapRef.current = 0;
        if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
        if (zone < 1 / 3) onSkip(-SKIP_SECONDS);
        else if (zone > 2 / 3) onSkip(SKIP_SECONDS);
        else onTogglePlay();
        show();
        return;
      }
      lastTapRef.current = now;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = setTimeout(() => {
        if (stateRef.current.settingsOpen) return;
        setVisible((v) => {
          if (!v) scheduleHide();
          return !v;
        });
      }, DOUBLE_TAP_MS);
    },
    [onSkip, onTogglePlay, scheduleHide, show]
  );

  const webkitVideo = videoEl as WebKitVideoElement | null;
  const supportsAirPlay = Boolean(webkitVideo?.webkitShowPlaybackTargetPicker);
  const supportsFullscreen = Boolean(
    containerEl?.requestFullscreen || webkitVideo?.webkitEnterFullscreen
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (containerEl?.requestFullscreen) {
      void containerEl.requestFullscreen();
    } else {
      // iPhone has no element fullscreen — hand off to the native player.
      webkitVideo?.webkitEnterFullscreen?.();
    }
  }, [containerEl, webkitVideo]);

  const busy = buffering || switching;

  return (
    <div
      className="absolute inset-0 z-10 select-none"
      onPointerUp={handleSurfaceTap}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse' && !visible) show();
      }}
    >
      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-white/80" aria-hidden />
        </div>
      )}

      {/* Top bar */}
      <div
        className={`absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent px-3 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))] transition-opacity ${shown ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close player"
          className="rounded-full p-2 text-white hover:bg-white/10"
        >
          <ChevronLeft className="h-6 w-6" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{title}</p>
          {subtitle && <p className="truncate text-xs text-white/60">{subtitle}</p>}
        </div>
        {supportsAirPlay && (
          <button
            type="button"
            onClick={() => webkitVideo?.webkitShowPlaybackTargetPicker?.()}
            aria-label="AirPlay"
            className="rounded-full p-2 text-white hover:bg-white/10"
          >
            <Airplay className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>

      {/* Center transport */}
      {shown && !busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-10">
          <button
            type="button"
            onClick={() => {
              onSkip(-SKIP_SECONDS);
              show();
            }}
            aria-label="Back 10 seconds"
            className="pointer-events-auto rounded-full p-3 text-white hover:bg-white/10"
          >
            <RotateCcw className="h-7 w-7" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => {
              onTogglePlay();
              show();
            }}
            aria-label={playing ? 'Pause' : 'Play'}
            className="pointer-events-auto rounded-full bg-white/10 p-4 text-white backdrop-blur hover:bg-white/20"
          >
            {playing ? (
              <Pause className="h-9 w-9 fill-current" aria-hidden />
            ) : (
              <Play className="h-9 w-9 translate-x-0.5 fill-current" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              onSkip(SKIP_SECONDS);
              show();
            }}
            aria-label="Forward 10 seconds"
            className="pointer-events-auto rounded-full p-3 text-white hover:bg-white/10"
          >
            <RotateCw className="h-7 w-7" aria-hidden />
          </button>
        </div>
      )}

      {/* Bottom bar */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-10 transition-opacity ${shown ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <SeekBar
          currentSeconds={currentSeconds}
          durationSeconds={durationSeconds}
          bufferedSeconds={bufferedSeconds}
          onSeekTo={(s) => {
            onSeekTo(s);
            show();
          }}
          onDraggingChange={setDragging}
        />
        <div className="flex items-center gap-1 text-white">
          <span className="font-mono text-xs tabular-nums text-white/80">
            {formatTime(currentSeconds)}
            <span className="text-white/40"> / {formatTime(durationSeconds)}</span>
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label="Playback settings"
            className="rounded-full p-2 hover:bg-white/10"
          >
            <Settings className="h-5 w-5" aria-hidden />
          </button>
          {supportsFullscreen && (
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="rounded-full p-2 hover:bg-white/10"
            >
              {isFullscreen ? (
                <Minimize className="h-5 w-5" aria-hidden />
              ) : (
                <Maximize className="h-5 w-5" aria-hidden />
              )}
            </button>
          )}
        </div>
      </div>

      <TrackMenus
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          scheduleHide();
        }}
        source={source}
        audioStreamIndex={audioStreamIndex}
        subtitleStreamIndex={subtitleStreamIndex}
        maxBitrate={maxBitrate}
        onSelectAudio={onSelectAudio}
        onSelectSubtitle={onSelectSubtitle}
        onSelectQuality={onSelectQuality}
      />
    </div>
  );
}
