'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Play, X } from 'lucide-react';
import type { EpisodeSummary } from '@/types/jellyfin-playback';

/** Everything the panel needs from the player; null hides the picker (movies). */
export interface EpisodePickerHandle {
  seriesName?: string;
  currentId: string;
  load: () => Promise<EpisodeSummary[]>;
  imageUrl: (episodeId: string) => string;
  onSelect: (episodeId: string) => void;
}

const TICKS_PER_MINUTE = 600_000_000;

function formatRuntime(ticks?: number): string | null {
  if (!ticks) return null;
  const minutes = Math.round(ticks / TICKS_PER_MINUTE);
  if (minutes < 1) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function EpisodeRow({
  episode,
  isCurrent,
  imageUrl,
  rowRef,
  onSelect,
}: {
  episode: EpisodeSummary;
  isCurrent: boolean;
  imageUrl: string;
  rowRef?: React.Ref<HTMLButtonElement>;
  onSelect: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const progress = episode.UserData?.PlayedPercentage ?? 0;
  const runtime = formatRuntime(episode.RunTimeTicks);
  return (
    <button
      type="button"
      ref={rowRef}
      onClick={onSelect}
      aria-current={isCurrent || undefined}
      className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/10 ${isCurrent ? 'bg-white/10' : ''}`}
    >
      <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-white/10">
        {!imgFailed && (
          // eslint-disable-next-line @next/next/no-img-element -- served directly by Jellyfin
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        )}
        {isCurrent && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Play className="h-5 w-5 fill-white text-white" aria-hidden />
          </div>
        )}
        {!isCurrent && progress > 0 && progress < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
            <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${isCurrent ? 'text-primary' : 'text-white/90'}`}>
          {episode.IndexNumber !== undefined && (
            <span className={isCurrent ? 'text-primary/70' : 'text-white/50'}>
              E{episode.IndexNumber} ·{' '}
            </span>
          )}
          {episode.Name}
        </p>
        <p className="mt-0.5 text-[11px] text-white/40">{isCurrent ? 'Now playing' : runtime}</p>
      </div>
      {episode.UserData?.Played && (
        <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Watched" />
      )}
    </button>
  );
}

/** Jellyfin-style in-player episode browser: season chips + episode list with watch state. */
export function EpisodePanel({
  open,
  onClose,
  picker,
}: {
  open: boolean;
  onClose: () => void;
  picker: EpisodePickerHandle;
}) {
  const [episodes, setEpisodes] = useState<EpisodeSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  // null = auto: the season of the episode that's playing.
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const currentRowRef = useRef<HTMLButtonElement | null>(null);

  const seasons = useMemo(() => {
    if (!episodes) return null;
    const groups = new Map<string, EpisodeSummary[]>();
    for (const ep of episodes) {
      const key = ep.SeasonName ?? `Season ${ep.ParentIndexNumber ?? '?'}`;
      const group = groups.get(key);
      if (group) group.push(ep);
      else groups.set(key, [ep]);
    }
    return [...groups.entries()];
  }, [episodes]);

  // Lazy fetch on first open; the list then lives for the rest of this playback.
  useEffect(() => {
    if (!open || episodes !== null || failed || loadingRef.current) return;
    let cancelled = false;
    loadingRef.current = true;
    picker
      .load()
      .then((items) => {
        if (!cancelled) setEpisodes(items);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        loadingRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [open, episodes, failed, picker]);

  const selected = useMemo(() => {
    if (!seasons || seasons.length === 0) return null;
    if (selectedSeason !== null) {
      const picked = seasons.find(([name]) => name === selectedSeason);
      if (picked) return picked;
    }
    return seasons.find(([, eps]) => eps.some((e) => e.Id === picker.currentId)) ?? seasons[0];
  }, [seasons, selectedSeason, picker.currentId]);

  useEffect(() => {
    if (open) currentRowRef.current?.scrollIntoView({ block: 'center' });
  }, [open, selected]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop: closes the panel without toggling the controls underneath */}
      <div className="absolute inset-0 z-30" onClick={onClose} aria-hidden />
      <div
        className="absolute inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-white/10 bg-black/95 pr-[env(safe-area-inset-right)] shadow-2xl backdrop-blur"
        role="dialog"
        aria-label="Episodes"
      >
        <div className="flex items-center gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">Episodes</p>
            {picker.seriesName && (
              <p className="truncate text-xs text-white/50">{picker.seriesName}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close episodes"
            className="rounded-full p-2 text-white hover:bg-white/10"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {seasons && seasons.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
            {seasons.map(([name]) => (
              <button
                key={name}
                type="button"
                onClick={() => setSelectedSeason(name)}
                aria-pressed={name === selected?.[0]}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  name === selected?.[0]
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {failed ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <p className="text-sm text-white/60">Couldn’t load episodes.</p>
              <button
                type="button"
                onClick={() => setFailed(false)}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
              >
                Retry
              </button>
            </div>
          ) : !seasons ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-white/60" aria-hidden />
            </div>
          ) : !selected || selected[1].length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-white/60">No episodes found.</p>
          ) : (
            selected[1].map((episode) => {
              const isCurrent = episode.Id === picker.currentId;
              return (
                <EpisodeRow
                  key={episode.Id}
                  episode={episode}
                  isCurrent={isCurrent}
                  imageUrl={picker.imageUrl(episode.Id)}
                  rowRef={isCurrent ? currentRowRef : undefined}
                  onSelect={() => {
                    picker.onSelect(episode.Id);
                    onClose();
                  }}
                />
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
