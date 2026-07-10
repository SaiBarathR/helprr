'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Clock, Dices, Film, RefreshCw, Star, Tv } from 'lucide-react';
import { ApiError } from '@/lib/query-fetch';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { hasCapability, useMe } from '@/components/permission-provider';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import type { WidgetProps } from '@/lib/widgets/types';
import type { RandomPick } from '@/types';
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

type FilterType = 'any' | 'movie' | 'series';

interface RandomWatchResponse {
  pick: RandomPick | null;
  poolSize: number;
}

async function fetchRandomWatch(
  type: FilterType,
  watch: 'all' | 'unwatched',
  signal?: AbortSignal,
): Promise<RandomWatchResponse> {
  const res = await fetch(`/api/random-watch?type=${type}&watch=${watch}`, { signal });
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SectionHeader
        title="Random Pick"
        badge={data && data.poolSize > 0 ? <Pill color={HPR.cyan} ghost>Pool {data.poolSize}</Pill> : null}
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
        <div
          className="no-scrollbar"
          style={{ display: 'flex', gap: 4, overflowX: 'auto', flexShrink: 0, paddingBottom: 6 }}
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
        <PickHero pick={pick} narrow={narrow} editMode={editMode} />
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
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        borderRadius: 12,
        overflow: 'hidden',
        background: HPR.ink,
      }}
    >
      {backdrop && !narrow && (
        <>
          <Image
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
        <div style={{ flexShrink: 0 }} className="@max-[159px]/cell:hidden">
          <Poster
            width={narrow ? 40 : 52}
            height={narrow ? 60 : 78}
            label={pick.title}
            tone={toneFromString(pick.title)}
            fontSize={8}
            imageUrl={poster ?? undefined}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: narrow ? 13 : 16,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: HPR.fg,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {pick.title}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 2,
              fontSize: 10,
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
            <div
              className="@max-[239px]/cell:hidden"
              style={{ display: 'flex', gap: 4, marginTop: 6, overflow: 'hidden' }}
            >
              {pick.genres.slice(0, 3).map((g) => (
                <Pill key={g} color={HPR.fgMute} ghost>
                  {g}
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
