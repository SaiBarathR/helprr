'use client';

// Full-screen now-playing sheet (vaul drawer): artwork, seek bar, transport,
// shuffle/repeat, and the queue. Pure music-store consumer — the actual
// <audio> lives in audio-engine.tsx.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { formatTime } from '@/lib/playback/time';
import { ticksToSeconds } from '@/lib/playback/player-machine';
import { useMusicStore } from '@/lib/playback/music-store';
import { cn } from '@/lib/utils';

function AudioSeekBar({
  positionSeconds,
  durationSeconds,
  onSeekTo,
}: {
  positionSeconds: number;
  durationSeconds: number;
  onSeekTo: (seconds: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const fractionFromEvent = useCallback((e: React.PointerEvent) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }, []);

  const fraction =
    dragFraction ?? (durationSeconds > 0 ? Math.min(positionSeconds / durationSeconds, 1) : 0);

  return (
    <div className="space-y-1">
      <div
        ref={barRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.floor(durationSeconds)}
        aria-valuenow={Math.floor(fraction * durationSeconds)}
        aria-valuetext={formatTime(fraction * durationSeconds)}
        className="group relative flex h-8 w-full cursor-pointer touch-none items-center"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragFraction(fractionFromEvent(e));
        }}
        onPointerMove={(e) => {
          if (dragFraction !== null) setDragFraction(fractionFromEvent(e));
        }}
        onPointerUp={(e) => {
          if (dragFraction !== null) {
            onSeekTo(fractionFromEvent(e) * durationSeconds);
            setDragFraction(null);
          }
        }}
        onPointerCancel={() => setDragFraction(null)}
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
        <div
          className="absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-primary"
          style={{ left: `${fraction * 100}%` }}
        />
      </div>
      <div className="flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
        <span>{formatTime(fraction * durationSeconds)}</span>
        <span>{formatTime(durationSeconds)}</span>
      </div>
    </div>
  );
}

export function NowPlayingSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queue = useMusicStore((s) => s.queue);
  const index = useMusicStore((s) => s.index);
  const playing = useMusicStore((s) => s.playing);
  const shuffle = useMusicStore((s) => s.shuffle);
  const repeat = useMusicStore((s) => s.repeat);
  const positionSeconds = useMusicStore((s) => s.positionSeconds);
  const durationSeconds = useMusicStore((s) => s.durationSeconds);
  const [artFailed, setArtFailed] = useState(false);

  const track = queue[index] ?? null;

  useEffect(() => {
    setArtFailed(false);
  }, [track?.id]);

  // Queue cleared (mini-player ✕) while the sheet is open.
  useEffect(() => {
    if (open && !track) onOpenChange(false);
  }, [open, track, onOpenChange]);

  if (!track) return null;

  const store = useMusicStore.getState();
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {/* The base DrawerContent is h-auto — pin the sheet height so it doesn't
          resize with the queue; the whole body scrolls (artwork included) so
          short viewports can still reach every queue row. */}
      <DrawerContent className="h-[90dvh]">
        <DrawerTitle className="sr-only">Now playing</DrawerTitle>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pt-2">
          <div className="mx-auto w-full max-w-sm space-y-4">
            <div className="mx-auto aspect-square w-48 overflow-hidden rounded-xl border bg-muted/40 sm:w-56">
              {!artFailed ? (
                // eslint-disable-next-line @next/next/no-img-element -- proxied, size-capped upstream
                <img
                  src={`/api/jellyfin/image?itemId=${track.albumId ?? track.id}&type=Primary&maxWidth=600`}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() => setArtFailed(true)}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Music className="h-12 w-12 text-muted-foreground/60" aria-hidden />
                </div>
              )}
            </div>
            <div className="text-center">
              <p className="truncate text-base font-semibold">{track.name}</p>
              <p className="truncate text-sm text-muted-foreground">
                {[track.artist, track.album].filter(Boolean).join(' · ')}
              </p>
            </div>

            <AudioSeekBar
              positionSeconds={positionSeconds}
              durationSeconds={
                durationSeconds > 0 ? durationSeconds : ticksToSeconds(track.runTimeTicks ?? 0)
              }
              onSeekTo={(s) => store.seek(s)}
            />

            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => store.toggleShuffle()}
                aria-label="Shuffle"
                aria-pressed={shuffle}
                className={cn(
                  'rounded-full p-2.5 transition-colors hover:bg-accent',
                  shuffle ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Shuffle className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => store.previous()}
                aria-label="Previous track"
                className="rounded-full p-2.5 transition-colors hover:bg-accent"
              >
                <SkipBack className="h-6 w-6 fill-current" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => store.setPlaying(!playing)}
                aria-label={playing ? 'Pause' : 'Play'}
                className="rounded-full bg-primary p-4 text-primary-foreground transition-transform active:scale-95"
              >
                {playing ? (
                  <Pause className="h-7 w-7 fill-current" aria-hidden />
                ) : (
                  <Play className="h-7 w-7 translate-x-0.5 fill-current" aria-hidden />
                )}
              </button>
              <button
                type="button"
                onClick={() => store.next()}
                aria-label="Next track"
                className="rounded-full p-2.5 transition-colors hover:bg-accent"
              >
                <SkipForward className="h-6 w-6 fill-current" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => store.cycleRepeat()}
                aria-label={`Repeat: ${repeat}`}
                aria-pressed={repeat !== 'off'}
                className={cn(
                  'rounded-full p-2.5 transition-colors hover:bg-accent',
                  repeat !== 'off' ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <RepeatIcon className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm">
            <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Queue · {queue.length}
            </p>
            <div className="space-y-0.5 pb-[env(safe-area-inset-bottom)]">
              {queue.map((t, i) => (
                <button
                  key={`${t.id}-${i}`}
                  type="button"
                  onClick={() => store.jumpTo(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent',
                    i === index && 'bg-accent/60'
                  )}
                >
                  <span
                    className={cn(
                      'w-5 shrink-0 text-right font-mono text-xs tabular-nums',
                      i === index ? 'text-primary' : 'text-muted-foreground'
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-sm',
                        i === index ? 'font-medium text-primary' : ''
                      )}
                    >
                      {t.name}
                    </span>
                    {t.artist && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {t.artist}
                      </span>
                    )}
                  </span>
                  {t.runTimeTicks !== undefined && (
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatTime(ticksToSeconds(t.runTimeTicks))}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
