'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Play, X } from 'lucide-react';
import { FadeInImage } from '@/components/media/fade-in-image';
import { catalogHref } from '@/components/jellyfin-streaming/card-shared';
import { jellyfinCardImage } from '@/lib/jellyfin-playback/image';
import { formatClock, ticksToSeconds } from '@/lib/jellyfin-playback/device';
import type { JellyfinItem } from '@/types/jellyfin';
import { cn } from '@/lib/utils';

type Tab = 'episodes' | 'similar';

/**
 * The phone detail screen's tab strip, as the app draws it: a hairline rule
 * with a red bar sitting on it under the active label, then either the season
 * picker and its episode list, or a poster grid.
 *
 * Episodes are laid out the app's way rather than the desktop overlay's: a
 * still on the left with the number, title and runtime beside it, and the
 * synopsis on its own full-width line underneath. On a phone that reads far
 * better than squeezing description text into the column next to a thumbnail.
 */
export function MobileDetailTabs({
  episodes,
  seasons,
  similar,
  currentSeasonId,
  onPlay,
}: {
  episodes: JellyfinItem[];
  seasons: JellyfinItem[];
  similar: JellyfinItem[];
  currentSeasonId?: string;
  onPlay: (item: JellyfinItem) => void;
}) {
  const hasEpisodes = episodes.length > 0;
  const hasSimilar = similar.length > 0;
  const [tab, setTab] = useState<Tab>(hasEpisodes ? 'episodes' : 'similar');
  const [pickerOpen, setPickerOpen] = useState(false);

  const activeSeason = useMemo(
    () => seasons.find((season) => season.Id === currentSeasonId) ?? seasons[0],
    [seasons, currentSeasonId],
  );

  if (!hasEpisodes && !hasSimilar) return null;

  const tabs: Array<{ id: Tab; label: string; shown: boolean }> = [
    { id: 'episodes', label: 'Episodes', shown: hasEpisodes },
    { id: 'similar', label: 'More Like This', shown: hasSimilar },
  ];

  return (
    <section className="-mx-[var(--main-pad-x)] mt-6">
      {/* The rule runs the full width and the indicator sits on top of it. */}
      <div className="relative flex gap-6 border-t border-white/15 px-[var(--main-pad-x)]">
        {tabs.filter((entry) => entry.shown).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? 'true' : undefined}
            className={cn(
              'relative -mt-px py-4 text-lg font-bold transition-colors',
              tab === entry.id ? 'text-white' : 'text-white/60',
            )}
          >
            {tab === entry.id && (
              <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-[#e50914]" />
            )}
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'episodes' && (
        <div className="px-[var(--main-pad-x)] pt-4">
          {seasons.length > 1 && activeSeason && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="mb-4 inline-flex items-center gap-2 rounded bg-[#2a2a2a] px-4 py-2.5 text-lg font-bold text-white"
            >
              {activeSeason.Name}
              <ChevronDown className="size-5" />
            </button>
          )}

          <ul className="space-y-6">
            {episodes.map((episode) => (
              <EpisodeRow key={episode.Id} episode={episode} onPlay={() => onPlay(episode)} />
            ))}
          </ul>
        </div>
      )}

      {tab === 'similar' && (
        <div className="grid grid-cols-3 gap-2 px-[var(--main-pad-x)] pt-4">
          {similar.map((entry) => {
            const poster = jellyfinCardImage(entry, 400, 'portrait');
            return (
              <Link
                key={entry.Id}
                href={catalogHref(entry)}
                className="relative block aspect-2/3 overflow-hidden rounded bg-white/5"
                aria-label={entry.Name}
              >
                {poster && (
                  <FadeInImage src={poster} alt={entry.Name} fill sizes="33vw" unoptimized className="object-cover" />
                )}
              </Link>
            );
          })}
        </div>
      )}

      {pickerOpen && activeSeason && (
        <SeasonPicker
          seasons={seasons}
          activeId={activeSeason.Id}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  );
}

function EpisodeRow({ episode, onPlay }: { episode: JellyfinItem; onPlay: () => void }) {
  const still = jellyfinCardImage(episode, 400, 'landscape');
  const runtime = ticksToSeconds(episode.RunTimeTicks);
  const progress = episode.UserData?.PlayedPercentage;

  return (
    <li>
      <button type="button" onClick={onPlay} className="flex w-full items-center gap-4 text-left">
        <span className="relative aspect-video w-[38%] shrink-0 overflow-hidden rounded bg-white/5">
          {still && <FadeInImage src={still} alt="" fill sizes="40vw" unoptimized className="object-cover" />}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-11 items-center justify-center rounded-full border-2 border-white/90">
              <Play className="size-5 fill-white text-white" />
            </span>
          </span>
          {typeof progress === 'number' && progress > 0 && progress < 100 && (
            <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/30">
              <span className="block h-full bg-[#e50914]" style={{ width: `${progress}%` }} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-white">
            {episode.IndexNumber != null ? `${episode.IndexNumber}. ` : ''}{episode.Name}
          </span>
          {runtime > 0 && <span className="mt-0.5 block text-sm text-[#b3b3b3]">{formatClock(runtime)}</span>}
        </span>
      </button>
      {/* Full width under the row, not beside the still — the app's layout. */}
      {episode.Overview && (
        <p className="mt-2 text-sm leading-relaxed text-[#b3b3b3]">{episode.Overview}</p>
      )}
    </li>
  );
}

/**
 * The season picker is a full-screen sheet with the list centred and the
 * current season set large, closed by a white circular button at the foot —
 * not a dropdown anchored to its trigger.
 */
function SeasonPicker({
  seasons,
  activeId,
  onClose,
}: {
  seasons: JellyfinItem[];
  activeId: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/90">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default" />

      <ul className="relative flex flex-1 flex-col items-center justify-center gap-7 overflow-y-auto py-16">
        {seasons.map((season) => (
          <li key={season.Id}>
            <Link
              href={catalogHref(season)}
              onClick={onClose}
              className={cn(
                'block text-center',
                season.Id === activeId ? 'text-2xl font-bold text-white' : 'text-xl font-normal text-white/85',
              )}
            >
              {season.Name}
            </Link>
          </li>
        ))}
      </ul>

      <div className="relative flex justify-center pb-10">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close season list"
          className="flex size-14 items-center justify-center rounded-full bg-white text-black"
        >
          <X className="size-7" />
        </button>
      </div>
    </div>
  );
}
