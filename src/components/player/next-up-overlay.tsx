'use client';

import { Play, X } from 'lucide-react';
import type { EpisodeSummary } from '@/types/jellyfin-playback';

/** End-of-episode countdown card; playback continuing to the end auto-advances. */
export function NextUpOverlay({
  episode,
  secondsRemaining,
  onPlayNow,
  onDismiss,
}: {
  episode: EpisodeSummary;
  secondsRemaining: number;
  onPlayNow: () => void;
  onDismiss: () => void;
}) {
  const code =
    episode.ParentIndexNumber !== undefined && episode.IndexNumber !== undefined
      ? `S${episode.ParentIndexNumber}:E${episode.IndexNumber}`
      : null;
  return (
    <div className="absolute bottom-24 right-3 z-20 w-72 rounded-xl border border-white/10 bg-black/90 p-3 shadow-2xl backdrop-blur">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
        Up next in {Math.max(0, Math.ceil(secondsRemaining))}s
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-white">
        {code && <span className="text-white/60">{code} · </span>}
        {episode.Name}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onPlayNow}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-black hover:bg-white/90"
        >
          <Play className="h-4 w-4 fill-current" aria-hidden />
          Play now
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss autoplay"
          className="rounded-lg bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
