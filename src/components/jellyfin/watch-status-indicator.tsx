'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isFullyWatched, type EpisodeWatchStatus, type WatchStatus } from '@/types/watch-status';

// Shared presentational pieces for the Jellyfin watch overlay. Pure props in,
// no data fetching — fed by useWatchStatus().lookup(...).

/** True when there's something worth drawing (watched, or partial progress). */
function hasProgress(status: WatchStatus): boolean {
  if (status.kind === 'movie') return status.played || status.playedPercentage > 0;
  return status.played || status.watchedEpisodeCount > 0;
}

/**
 * Poster overlay: a watched/“X·Y” badge top-left and a resume bar along the
 * bottom. Drop inside a `relative` poster container. Renders nothing when the
 * item is wholly unwatched (keeps untouched posters clean).
 */
export function PosterWatchOverlay({ status }: { status: WatchStatus | undefined }) {
  if (!status || !hasProgress(status)) return null;

  const fullyWatched = isFullyWatched(status);
  const moviePercent = status.kind === 'movie' && !status.played ? status.playedPercentage : 0;

  return (
    <>
      <div className="absolute top-1.5 left-1.5 z-[1] flex items-center gap-0.5 rounded bg-background/70 px-1 py-0.5 backdrop-blur-sm">
        {fullyWatched ? (
          <Check className="h-2.5 w-2.5 text-[var(--hpr-amber)]" strokeWidth={3} />
        ) : status.kind === 'series' ? (
          <span className="text-[9px] font-semibold leading-none text-foreground">
            {status.watchedEpisodeCount}<span className="text-foreground/50">/{status.totalEpisodeCount}</span>
          </span>
        ) : (
          <span className="text-[9px] font-semibold leading-none text-[var(--hpr-amber)]">{moviePercent}%</span>
        )}
      </div>
      {!fullyWatched && moviePercent > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-[1] h-[3px] bg-background/50">
          <div className="h-full bg-[var(--hpr-amber)]" style={{ width: `${moviePercent}%` }} />
        </div>
      )}
    </>
  );
}

/** Compact inline badge for list/table rows and badge rows. */
export function WatchStatusInline({ status, className }: { status: WatchStatus | undefined; className?: string }) {
  if (!status || !hasProgress(status)) return null;

  const fullyWatched = isFullyWatched(status);

  const label = fullyWatched
    ? 'Watched'
    : status.kind === 'series'
      ? `${status.watchedEpisodeCount}/${status.totalEpisodeCount} watched`
      : `${status.playedPercentage}% watched`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded bg-[var(--hpr-amber)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--hpr-amber)]',
        className,
      )}
    >
      {fullyWatched && <Check className="h-3 w-3" strokeWidth={3} />}
      {label}
    </span>
  );
}

/**
 * Per-episode indicator for the series detail episode list: a check when
 * watched, a slim resume bar when in progress, nothing when unwatched.
 */
export function EpisodeWatchIndicator({ status }: { status: EpisodeWatchStatus | undefined }) {
  if (!status) return null;
  if (status.played) {
    return <Check className="h-3.5 w-3.5 text-[var(--hpr-amber)]" strokeWidth={3} aria-label="Watched" />;
  }
  if (status.playedPercentage > 0) {
    return (
      <span className="inline-block h-1 w-8 overflow-hidden rounded-full bg-muted" aria-label={`${status.playedPercentage}% watched`}>
        <span className="block h-full bg-[var(--hpr-amber)]" style={{ width: `${status.playedPercentage}%` }} />
      </span>
    );
  }
  return null;
}
