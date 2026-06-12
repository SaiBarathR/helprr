'use client';

// Floating music bar (plan §G): shows the current track above the bottom nav
// on mobile / bottom-right on desktop, with the full now-playing sheet a tap
// away. Renders nothing while the queue is empty.

import { useEffect, useState } from 'react';
import { Music, Pause, Play, SkipForward, X } from 'lucide-react';
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [artFailed, setArtFailed] = useState(false);
  // The persisted queue rehydrates client-side only — render after mount so
  // SSR and the first client render agree (no hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => setArtFailed(false), [track?.id]);

  if (!mounted || !canPlay || !track) return null;

  const store = useMusicStore.getState();
  const progress = durationSeconds > 0 ? Math.min(positionSeconds / durationSeconds, 1) : 0;

  return (
    <>
      <div
        className={cn(
          'fixed left-2 right-2 z-40 overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur md:bottom-4 md:left-auto md:right-4 md:w-96',
          navPosition === 'bottom'
            ? 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))]'
            : 'bottom-[calc(0.5rem+env(safe-area-inset-bottom))]'
        )}
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
