'use client';

import { useCallback, useState } from 'react';
import { HeroImage } from '@/components/media/hero-image';
import Link from '@/components/ui/app-link';
import { Clock, Dices, Film, RefreshCw, Star, Tv } from 'lucide-react';
import { ApiError } from '@/lib/query-fetch';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { hasCapability, useMe } from '@/components/permission-provider';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import type { WidgetProps } from '@/lib/widgets/types';
import type { RandomPick, RandomWatchFilterType as FilterType } from '@/types';
import {
  EmptyState,
  FONT_DISPLAY,
  FONT_MONO,
  HPR,
  Pill,
  Poster,
  SectionHeader,
  mix,
  toneFromString,
} from './bento-primitives';
import { useWidgetFilter } from './use-widget-filter';
import { CompactRailTile } from './compact-rail-tile';
import { fetchOrOffline } from '@/lib/network-error';

interface RandomWatchResponse {
  pick: RandomPick | null;
  poolSize: number;
}

async function fetchRandomWatch(
  type: FilterType,
  watch: 'all' | 'unwatched',
  signal?: AbortSignal,
): Promise<RandomWatchResponse> {
  const res = await fetchOrOffline(`/api/random-watch?type=${type}&watch=${watch}`, {
    signal,
    cache: 'no-store',
  });
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  return res.json();
}

/**
 * "What should I watch?" hero — one random downloaded title with a reroll
 * button. Each poll interval also lands a fresh pick, so the tile rotates
 * ambiently. Filters mirror the /random page and persist per-widget.
 */
export function RandomWatchWidget({
  refreshInterval,
  editMode = false,
  narrow = false,
  rowSpan,
}: WidgetProps) {
  const me = useMe();
  const canFilterUnwatched = me?.jellyfinLinked === true && hasCapability(me, 'jellyfin.view');
  const [filters, setFilters] = useWidgetFilter<{ type: FilterType; watch: 'all' | 'unwatched' }>(
    'random-watch',
    { type: 'any', watch: 'all' },
  );
  const watch = canFilterUnwatched && filters.watch === 'unwatched' ? 'unwatched' : 'all';
  const fetchFn = useCallback(
    (signal?: AbortSignal) => fetchRandomWatch(filters.type, watch, signal),
    [filters.type, watch],
  );
  const { data, loading, refresh } = useWidgetData<RandomWatchResponse>({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `random-watch-${filters.type}-${watch}`,
  });
  const [rolling, setRolling] = useState(false);
  const reroll = async () => {
    if (rolling || editMode) return;
    setRolling(true);
    try {
      await refresh();
    } finally {
      setRolling(false);
    }
  };

  const pick = data?.pick ?? null;

  // Any one-row cell: under the header (and the filter chips in a wide one) the
  // hero had 4–30px left, too little for any of the pick, so it takes the
  // Discover rails' compact tile, as For You and Upcoming do in a 2×1. Unlike
  // theirs, this layout is a hero and can't shrink to one row. The label opens
  // the Random mode of For You; a new pick still lands with every poll.
  if ((rowSpan ?? 1) <= 1) {
    const hint = pick?.mediaType === 'movie' ? 'radarr' : 'sonarr';
    return (
      <CompactRailTile
        title="Random Pick"
        viewAllHref="/recommendations?mode=random"
        editMode={editMode}
        // Edit mode doesn't load, so "nothing" would be untrue there.
        note={loading ? 'Rolling…' : editMode ? 'Random title' : 'Nothing matches'}
        item={pick ? {
          href: pick.href,
          title: pick.title,
          meta: [pick.year, pick.mediaType === 'movie' ? 'Movie' : 'Series'].filter(Boolean).join(' · '),
          imageUrl: pick.posterUrl ? toCachedImageSrc(pick.posterUrl, hint) ?? pick.posterUrl : null,
        } : null}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SectionHeader
        // Whole words: a cell too narrow for the name beside the reroll button
        // (a half-width phone cell at 320) reads "Random", not "Rando…".
        title={(
          <>
            <span className="@max-[129px]/cell:hidden">Random Pick</span>
            <span className="hidden @max-[129px]/cell:inline">Random</span>
          </>
        )}
        // The pool size is a detail: below 240px it pushed the title into an
        // ellipsis, or the header onto three rows that left the pick no room.
        badge={data && data.poolSize > 0 ? (
          <span className="@max-[239px]/cell:hidden">
            <Pill color={HPR.cyan} ghost>Pool {data.poolSize}</Pill>
          </span>
        ) : null}
        right={
          <button
            type="button"
            onClick={reroll}
            disabled={editMode || rolling}
            aria-label="Reroll"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: 8,
              border: `1px solid ${mix(HPR.cyan, 30)}`,
              background: mix(HPR.cyan, 14),
              color: HPR.cyan,
              cursor: editMode || rolling ? 'default' : 'pointer',
            }}
          >
            <RefreshCw size={12} className={rolling ? 'animate-spin' : undefined} />
          </button>
        }
      />

      {!narrow && (
        // Hidden whole where the chips don't all fit (as on half-width phone
        // cells), instead of the last one being cut at the edge ("S" for Series
        // in a narrow tablet cell).
        <div
          className="no-scrollbar flex @max-[229px]/cell:hidden"
          style={{ gap: 4, overflowX: 'auto', flexShrink: 0, paddingBottom: 6 }}
          role="group"
          aria-label="Random pick filters"
        >
          {(['any', 'movie', 'series'] as FilterType[]).map((t) => (
            <FilterChip
              key={t}
              active={filters.type === t}
              disabled={editMode}
              onClick={() => setFilters((prev) => ({ ...prev, type: t }))}
            >
              {t === 'any' ? 'All' : t === 'movie' ? 'Movies' : 'Series'}
            </FilterChip>
          ))}
          {canFilterUnwatched && (
            <FilterChip
              active={filters.watch === 'unwatched'}
              disabled={editMode}
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  watch: prev.watch === 'unwatched' ? 'all' : 'unwatched',
                }))
              }
            >
              Unwatched
            </FilterChip>
          )}
        </div>
      )}

      {loading && !pick ? (
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Rolling…</div>
      ) : !pick ? (
        <EmptyState>
          <Dices size={18} />
          Nothing downloaded matches this filter.
        </EmptyState>
      ) : (
        <PickHero
          key={`${filters.type}:${watch}:${pick.mediaType}:${pick.instanceId}:${pick.id}`}
          pick={pick}
          narrow={narrow}
          editMode={editMode}
        />
      )}
    </div>
  );
}

function FilterChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      aria-pressed={active}
      style={{ background: 'none', border: 'none', padding: 0, cursor: disabled ? 'default' : 'pointer' }}
    >
      <Pill color={active ? HPR.cyan : HPR.fgMute} ghost={!active}>
        {children}
      </Pill>
    </button>
  );
}

function PickHero({
  pick,
  narrow,
  editMode,
}: {
  pick: RandomPick;
  narrow: boolean;
  editMode: boolean;
}) {
  const hint = pick.mediaType === 'movie' ? 'radarr' : 'sonarr';
  const poster = pick.posterUrl ? toCachedImageSrc(pick.posterUrl, hint) ?? pick.posterUrl : null;
  const backdrop = pick.backdropUrl
    ? toCachedImageSrc(pick.backdropUrl, hint, { width: 640 }) ?? pick.backdropUrl
    : null;

  const hero = (
    <div
      // A size container: in a short hero (a one-row 4×1 phone cell) globals.css
      // hides the poster, chips, facts and title whole, in that order, instead
      // of cutting them at the hero's top.
      className="rp-hero"
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        borderRadius: 12,
        overflow: 'hidden',
        background: HPR.ink,
      }}
    >
      {/* At every size: without it a narrow cell's hero was an empty black block above the title. */}
      {backdrop && (
        <>
          <HeroImage
            src={backdrop}
            alt=""
            fill
            sizes="640px"
            className="object-cover"
            unoptimized={isProtectedApiImageSrc(backdrop)}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(to top, ${HPR.ink} 15%, color-mix(in oklab, ${HPR.ink} 55%, transparent) 60%, transparent)`,
            }}
          />
        </>
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 10,
          padding: 10,
        }}
      >
        <div style={{ flexShrink: 0 }} className="rp-hero-poster @max-[159px]/cell:hidden">
          <Poster
            width={narrow ? 40 : 52}
            height={narrow ? 60 : 78}
            label={pick.title}
            tone={toneFromString(pick.title)}
            fontSize={8}
            imageUrl={poster ?? undefined}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }} className="rp-hero-text">
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: narrow ? 13 : 16,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: HPR.fg,
            }}
            // Two lines of whole words before an ellipsis in a narrow cell (under
            // 240px, where the genre row is hidden and leaves the room), so it
            // doesn't cut the title to its first letters. Wider cells keep one
            // line; a one-column phone cell, too narrow for most words, keeps
            // one line ending in "…" rather than breaking words across lines.
            className="line-clamp-2 @min-[240px]/cell:line-clamp-1 @max-[99px]/cell:line-clamp-1 @max-[99px]/cell:break-all"
          >
            {pick.title}
          </div>
          {/* Whole facts only, like the genre chips below: one that doesn't
              fit wraps onto a hidden second line instead of being cut. */}
          <div
            className="rp-hero-meta"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '8px 8px',
              marginTop: 2,
              fontSize: 10,
              lineHeight: '14px',
              height: 14,
              color: HPR.fgMute,
              fontFamily: FONT_MONO,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {pick.year !== null && <span>{pick.year}</span>}
            {pick.runtime !== null && pick.runtime > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Clock size={10} />
                {pick.runtime}m
              </span>
            )}
            {pick.rating !== null && pick.rating > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: HPR.amber }}>
                <Star size={10} fill="currentColor" />
                {pick.rating.toFixed(1)}
              </span>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {pick.mediaType === 'movie' ? <Film size={10} /> : <Tv size={10} />}
              {pick.mediaType === 'movie' ? 'Movie' : 'Series'}
            </span>
          </div>
          {!narrow && pick.genres.length > 0 && (
            // One row of whole chips: a chip that doesn't fit wraps onto a
            // second row the fixed height hides, instead of being cut mid-word.
            // A lone chip wider than the row ends in an ellipsis.
            <div
              // display in the class, not the style, which would override the
              // container query that hides the row in cells under 240px.
              className="rp-hero-genres flex @max-[239px]/cell:hidden"
              style={{ flexWrap: 'wrap', gap: '8px 4px', marginTop: 6, height: 20, overflow: 'hidden' }}
            >
              {pick.genres.slice(0, 3).map((g) => (
                <Pill key={g} color={HPR.fgMute} ghost style={{ lineHeight: '14px', maxWidth: '100%', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{g}</span>
                </Pill>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (editMode) return hero;

  return (
    <Link
      href={pick.href}
      // Its name even where a short hero hides the title (globals.css).
      aria-label={pick.title}
      style={{
        textDecoration: 'none',
        color: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      {hero}
    </Link>
  );
}
