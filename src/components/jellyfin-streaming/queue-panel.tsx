'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FadeInImage } from '@/components/media/fade-in-image';
import { jellyfinCardImage } from '@/lib/jellyfin-playback/image';
import { ticksToSeconds } from '@/lib/jellyfin-playback/device';
import { formatRuntimeShort } from '@/lib/jellyfin-playback/metadata';
import type { JellyfinItem } from '@/types/jellyfin';
import { cn } from '@/lib/utils';

/** One rendered block: a season heading and the episodes under it. */
interface QueueGroup {
  key: string;
  label: string | null;
  entries: Array<{ item: JellyfinItem; index: number }>;
}

/**
 * Group an episode queue by season.
 *
 * jellyfin-web has no episode list in its player at all — its queue is a flat
 * playlist and, for an episode, that playlist is only ever "this episode and
 * the ones after it" (playbackManager `translateItemsForPlayback`). So there is
 * nothing upstream to copy the presentation from, and this follows the site's
 * player instead: the whole show, split by season, with the episode on screen
 * marked in place.
 *
 * Anything that is not a run of episodes from one series — an album, a box set,
 * a hand-built queue — stays a single flat list, because seasons mean nothing
 * to it.
 */
function groupQueue(queue: JellyfinItem[]): QueueGroup[] {
  const seriesIds = new Set(queue.map((item) => item.SeriesId).filter(Boolean));
  const allEpisodes = queue.length > 0 && queue.every((item) => item.Type === 'Episode');
  if (!allEpisodes || seriesIds.size !== 1) {
    return [{ key: 'all', label: null, entries: queue.map((item, index) => ({ item, index })) }];
  }

  const groups: QueueGroup[] = [];
  queue.forEach((item, index) => {
    const season = item.ParentIndexNumber;
    const key = `season-${season ?? 'other'}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.entries.push({ item, index });
      return;
    }
    groups.push({
      key,
      label: item.SeasonName ?? (season != null ? `Season ${season}` : 'Specials'),
      entries: [{ item, index }],
    });
  });
  return groups;
}

function rowLabel(item: JellyfinItem): string {
  if (item.Type === 'Episode' && item.ParentIndexNumber != null && item.IndexNumber != null) {
    return `${item.IndexNumber}. ${item.Name}`;
  }
  return item.Name ?? '';
}

/**
 * The player's queue: what is playing, what came before it and what is next.
 *
 * Every fault the owner reported here came from the queue's *shape* rather than
 * from this panel — a thirteen-episode show listed nine entries and highlighted
 * the wrong one because the queue itself started at the episode being played.
 * With the queue carrying the series and the index carrying the position (see
 * playback-provider's resolvePlayable), the panel can do what the site's does:
 * list the show, mark the row on screen and scroll to it.
 */
export function QueuePanel({
  queue,
  index,
  onPick,
  onClose,
}: {
  queue: JellyfinItem[];
  /** Index of the entry currently playing. */
  index: number;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => groupQueue(queue), [queue]);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const current = queue[index];
  // The queue can run to hundreds of episodes, so opening it anywhere but on
  // the episode playing is a scroll hunt. `auto` rather than `smooth`: the
  // panel has only just mounted and animating from the top of a long list is
  // a distraction, not a transition.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [index]);

  const heading = current?.Type === 'Episode' && current.SeriesName ? current.SeriesName : 'Queue';

  return (
    <div
      className={cn(
        // z-[90] keeps it over the expanded player (z-[80]); the player's own
        // chrome stays reachable underneath it rather than being covered.
        'fixed inset-y-0 right-0 z-[90] flex w-full max-w-sm flex-col bg-[#181818] shadow-2xl',
        // Deliberately not the app's glass material: the panel sits on a video,
        // and a frosted sheet over moving picture is unreadable.
        'border-l border-white/10',
      )}
      role="dialog"
      aria-label={`${heading} queue`}
    >
      <div className="flex items-start gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{heading}</p>
          <p className="text-[11px] text-white/60">
            {queue.length} {queue.length === 1 ? 'title' : 'titles'}
            {queue.length > 1 && ` · ${index + 1} of ${queue.length} playing`}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" className="shrink-0 text-white" onClick={onClose} aria-label="Close queue">
          <X />
        </Button>
      </div>

      <div className="hpr-cine-scroll flex-1 overflow-y-auto overscroll-contain">
        {groups.map((group) => (
          <section key={group.key}>
            {group.label && (
              // Sticky, so you always know which season you are scrolling
              // through in a long show.
              <h3 className="sticky top-0 z-10 bg-[#181818]/95 px-4 py-2 text-[11px] font-semibold tracking-wide text-white/60 uppercase backdrop-blur-sm">
                {group.label}
              </h3>
            )}
            <ul>
              {group.entries.map(({ item, index: entryIndex }) => (
                <QueueRow
                  key={`${item.Id}-${entryIndex}`}
                  ref={entryIndex === index ? activeRef : undefined}
                  item={item}
                  position={entryIndex + 1}
                  active={entryIndex === index}
                  onPick={() => onPick(entryIndex)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function QueueRow({
  ref,
  item,
  position,
  active,
  onPick,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  item: JellyfinItem;
  position: number;
  active: boolean;
  onPick: () => void;
}) {
  const still = jellyfinCardImage(item, 320, 'landscape');
  const runtime = ticksToSeconds(item.RunTimeTicks);
  const progress = item.UserData?.PlayedPercentage;
  const played = item.UserData?.Played;

  return (
    <li>
      <button
        ref={ref}
        type="button"
        onClick={onPick}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'group/queue relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
          active ? 'bg-white/10' : 'hover:bg-white/5',
        )}
      >
        {/* The site marks the row on screen with a bar in its brand red rather
            than by weight alone — in a list of near-identical episode stills
            that is the only marker that reads at a glance. */}
        {active && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[#e50914]" />}

        <span
          className={cn(
            'w-4 shrink-0 pt-1 text-center text-[11px] tabular-nums',
            active ? 'text-white' : 'text-white/45',
          )}
        >
          {item.Type === 'Episode' ? (item.IndexNumber ?? position) : position}
        </span>

        <span className="relative aspect-video w-[104px] shrink-0 overflow-hidden rounded bg-white/5">
          {still && <FadeInImage src={still} alt="" fill sizes="104px" unoptimized className="object-cover" />}
          <span
            className={cn(
              'absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity',
              active ? 'opacity-100' : 'opacity-0 group-hover/queue:opacity-100',
            )}
          >
            <Play className="size-5 fill-white text-white" />
          </span>
          {typeof progress === 'number' && progress > 0 && progress < 100 && (
            <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/30">
              <span className="block h-full bg-[#e50914]" style={{ width: `${progress}%` }} />
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-[13px]', active ? 'font-semibold text-white' : 'text-white/90')}>
              {rowLabel(item)}
            </span>
            {runtime > 0 && (
              <span className="shrink-0 text-[11px] text-white/55">{formatRuntimeShort(runtime)}</span>
            )}
          </span>
          {active ? (
            <span className="mt-0.5 block text-[11px] font-medium text-[#e50914]">Now playing</span>
          ) : played ? (
            <span className="mt-0.5 block text-[11px] text-white/45">Watched</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
