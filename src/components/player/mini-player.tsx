'use client';

// Floating music bar (plan §G): shows the current track above the bottom nav
// on mobile / bottom-right on desktop, with the full now-playing sheet a tap
// away. Renders nothing while the queue is empty.

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronLeft,
  ChevronRight,
  Music,
  Pause,
  Play,
  SkipForward,
  X,
} from 'lucide-react';
import { useCan } from '@/components/permission-provider';
import { useMusicStore } from '@/lib/playback/music-store';
import { useUIStore } from '@/lib/store';
import { NowPlayingSheet } from '@/components/player/now-playing';
import { cn } from '@/lib/utils';

export function MiniPlayer() {
  const canPlay = useCan('jellyfin.play');
  const track = useMusicStore((s) => s.queue[s.index] ?? null);
  const playing = useMusicStore((s) => s.playing);
  const positionSeconds = useMusicStore((s) => s.positionSeconds);
  const durationSeconds = useMusicStore((s) => s.durationSeconds);
  const navPosition = useUIStore((s) => s.navPosition);
  // Docked = the player lives in the desktop sidebar (see SidebarPlayer);
  // the floating bar stays for mobile, where there is no sidebar.
  const docked = useUIStore((s) => s.musicPlayerDocked);
  const setDocked = useUIStore((s) => s.setMusicPlayerDocked);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [artFailed, setArtFailed] = useState(false);
  // PiP-style tuck: drag the bar toward a screen edge to collapse it into a
  // small arrow tab there (like iOS picture-in-picture); tap the tab to restore.
  const [tucked, setTucked] = useState<'left' | 'right' | null>(null);
  const [dragX, setDragX] = useState(0);
  const dragStartX = useRef<number | null>(null);
  const didDrag = useRef(false);
  // The persisted queue rehydrates client-side only — render after mount so
  // SSR and the first client render agree (no hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => setArtFailed(false), [track?.id]);

  if (!mounted || !canPlay || !track) return null;

  const store = useMusicStore.getState();
  const progress = durationSeconds > 0 ? Math.min(positionSeconds / durationSeconds, 1) : 0;
  const bottomClass =
    navPosition === 'bottom'
      ? 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))]'
      : 'bottom-[calc(0.5rem+env(safe-area-inset-bottom))]';

  if (tucked) {
    return (
      <button
        type="button"
        onClick={() => setTucked(null)}
        aria-label="Show music player"
        className={cn(
          'fixed z-40 flex h-12 w-7 items-center justify-center border bg-background/95 shadow-lg backdrop-blur md:bottom-4',
          tucked === 'right' ? 'right-0 rounded-l-xl border-r-0' : 'left-0 rounded-r-xl border-l-0',
          docked && 'md:hidden',
          bottomClass
        )}
      >
        {tucked === 'right' ? (
          <ChevronLeft className="h-4 w-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
      </button>
    );
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return;
    const dx = e.clientX - dragStartX.current;
    dragStartX.current = null;
    setDragX(0);
    if (didDrag.current && Math.abs(dx) > 72) setTucked(dx > 0 ? 'right' : 'left');
  };

  return (
    <>
      <div
        className={cn(
          'fixed left-2 right-2 z-40 touch-pan-y overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur md:bottom-4 md:left-auto md:right-4 md:w-96',
          dragX === 0 && 'transition-transform duration-200',
          docked && 'md:hidden',
          bottomClass
        )}
        style={dragX !== 0 ? { transform: `translateX(${dragX}px)` } : undefined}
        onPointerDown={(e) => {
          dragStartX.current = e.clientX;
          didDrag.current = false;
        }}
        onPointerMove={(e) => {
          if (dragStartX.current === null) return;
          const dx = e.clientX - dragStartX.current;
          if (!didDrag.current && Math.abs(dx) < 10) return;
          if (!didDrag.current) {
            didDrag.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setDragX(dx);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // A drag that ends over a button must not also trigger it.
        onClickCapture={(e) => {
          if (didDrag.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <div className="absolute inset-x-0 top-0 h-0.5 bg-muted">
          <div className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="flex items-center gap-1 p-2">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-label="Open now playing"
          >
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-muted/40">
              {!artFailed ? (
                // eslint-disable-next-line @next/next/no-img-element -- proxied, size-capped upstream
                <img
                  src={`/api/jellyfin/image?itemId=${track.albumId ?? track.id}&type=Primary&maxWidth=120`}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() => setArtFailed(true)}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Music className="h-4 w-4 text-muted-foreground/60" aria-hidden />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{track.name}</p>
              {track.artist && (
                <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
              )}
            </div>
          </button>
          <button
            type="button"
            onClick={() => store.setPlaying(!playing)}
            aria-label={playing ? 'Pause' : 'Play'}
            className="rounded-full p-2 transition-colors hover:bg-accent"
          >
            {playing ? (
              <Pause className="h-5 w-5 fill-current" aria-hidden />
            ) : (
              <Play className="h-5 w-5 fill-current" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => store.next()}
            aria-label="Next track"
            className="rounded-full p-2 transition-colors hover:bg-accent"
          >
            <SkipForward className="h-5 w-5 fill-current" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setTucked('right')}
            aria-label="Tuck player to the edge"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent md:hidden"
          >
            <ArrowRightToLine className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setDocked(true)}
            aria-label="Snap player into sidebar"
            className="hidden rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent md:inline-flex"
          >
            <ArrowLeftToLine className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => store.clear()}
            aria-label="Stop and clear queue"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>
      <NowPlayingSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
