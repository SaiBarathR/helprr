'use client';

// Docked variant of the music mini player: lives at the bottom of the desktop
// sidebar when the user snaps it there from the floating bar. Pop-out returns
// it to the floating bar. Renders nothing while undocked or the queue is empty.

import { useEffect, useState } from 'react';
import { ArrowRightFromLine, Music, Pause, Play, SkipForward } from 'lucide-react';
import { useCan } from '@/components/permission-provider';
import { useMusicStore } from '@/lib/playback/music-store';
import { useUIStore } from '@/lib/store';
import { NowPlayingSheet } from '@/components/player/now-playing';

export function SidebarPlayer() {
  const canPlay = useCan('jellyfin.play');
  const track = useMusicStore((s) => s.queue[s.index] ?? null);
  const playing = useMusicStore((s) => s.playing);
  const positionSeconds = useMusicStore((s) => s.positionSeconds);
  const durationSeconds = useMusicStore((s) => s.durationSeconds);
  const docked = useUIStore((s) => s.musicPlayerDocked);
  const setDocked = useUIStore((s) => s.setMusicPlayerDocked);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [artFailed, setArtFailed] = useState(false);
  // The persisted queue rehydrates client-side only — render after mount so
  // SSR and the first client render agree (no hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => setArtFailed(false), [track?.id]);

  if (!mounted || !docked || !canPlay || !track) return null;

  const store = useMusicStore.getState();
  const progress = durationSeconds > 0 ? Math.min(positionSeconds / durationSeconds, 1) : 0;

  const art = !artFailed ? (
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
  );

  if (sidebarCollapsed) {
    // Icon-rail mode: just the artwork; the full controls live in the sheet.
    return (
      <>
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label="Open now playing"
            className="mx-auto block h-10 w-10 overflow-hidden rounded-md border bg-muted/40"
          >
            {art}
          </button>
          <div className="mx-auto mt-1.5 h-0.5 w-10 overflow-hidden rounded bg-muted">
            <div className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        <NowPlayingSheet open={sheetOpen} onOpenChange={setSheetOpen} />
      </>
    );
  }

  return (
    <>
      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex w-full min-w-0 items-center gap-2.5 rounded-md p-1 text-left transition-colors hover:bg-accent"
          aria-label="Open now playing"
        >
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-muted/40">
            {art}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{track.name}</p>
            {track.artist && (
              <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
            )}
          </div>
        </button>
        <div className="mt-1.5 h-0.5 overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => store.setPlaying(!playing)}
            aria-label={playing ? 'Pause' : 'Play'}
            className="rounded-full p-2 transition-colors hover:bg-accent"
          >
            {playing ? (
              <Pause className="h-4 w-4 fill-current" aria-hidden />
            ) : (
              <Play className="h-4 w-4 fill-current" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => store.next()}
            aria-label="Next track"
            className="rounded-full p-2 transition-colors hover:bg-accent"
          >
            <SkipForward className="h-4 w-4 fill-current" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setDocked(false)}
            aria-label="Pop player out of sidebar"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent"
          >
            <ArrowRightFromLine className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <NowPlayingSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
