'use client';

import Link from 'next/link';
import { Bookmark, Film, Sparkles, Tv } from 'lucide-react';
import { ApiError } from '@/lib/query-fetch';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { formatDistanceToNowShort } from '@/lib/format';
import { toCachedImageSrc } from '@/lib/image';
import type { WidgetProps } from '@/lib/widgets/types';
import {
  CAROUSEL_CARD_HEIGHT,
  CAROUSEL_CARD_WIDTH,
  CAROUSEL_GAP,
  EmptyState,
  Eyebrow,
  FONT_DISPLAY,
  FONT_MONO,
  HPR,
  ICON_HIDE_HEIGHT_THRESHOLD,
  ICON_HIDE_THRESHOLD,
  LIST_ROW_HEIGHT,
  Pill,
  Poster,
  SectionHeader,
  ViewModeToggle,
  mix,
  toneFromString,
} from './bento-primitives';
import { useDashboardLayout } from './dashboard-layout-context';

interface WatchlistWidgetItem {
  id: string;
  source: string;
  mediaType: 'movie' | 'series' | 'anime';
  title: string;
  year: number | null;
  posterUrl: string | null;
  addedAt: string;
  href: string | null;
  tags: Array<{ id: string; name: string; color: string | null }>;
}

function posterHint(source: string): 'tmdb' | 'anilist' | 'sonarr' | 'radarr' | undefined {
  switch (source) {
    case 'TMDB': return 'tmdb';
    case 'ANILIST': return 'anilist';
    case 'SONARR': return 'sonarr';
    case 'RADARR': return 'radarr';
    default: return undefined;
  }
}

function posterSrcOf(item: WatchlistWidgetItem): string | null {
  if (!item.posterUrl) return null;
  return toCachedImageSrc(item.posterUrl, posterHint(item.source)) ?? item.posterUrl;
}

function typeBadge(mediaType: WatchlistWidgetItem['mediaType']) {
  if (mediaType === 'movie') {
    return { icon: <Film size={11} strokeWidth={2.4} />, color: HPR.blue };
  }
  if (mediaType === 'anime') {
    return { icon: <Sparkles size={11} strokeWidth={2.4} />, color: HPR.pink };
  }
  return { icon: <Tv size={11} strokeWidth={2.4} />, color: HPR.purple };
}

async function fetchWatchlist(signal?: AbortSignal): Promise<WatchlistWidgetItem[]> {
  const res = await fetch('/api/watchlist', { signal });
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data = (await res.json()) as WatchlistWidgetItem[];
  if (!Array.isArray(data)) return [];
  // Newest additions first — the widget is a "what did I save lately" surface.
  return [...data].sort(
    (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
  );
}

export function WatchlistWidget({
  refreshInterval,
  editMode = false,
  narrow = false,
  layoutVariant,
  rowSpan,
  instanceId,
  mobileGrid = false,
}: WidgetProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const { setWidgetLayoutOverride } = useDashboardLayout();
  const { visibleCount: listVisible } = useListFetchSize({
    height,
    rowHeight: LIST_ROW_HEIGHT,
  });
  const carouselVisible = width > 0
    ? Math.ceil(width / (CAROUSEL_CARD_WIDTH + CAROUSEL_GAP)) + 4
    : 12;
  const visibleCount = Math.max(listVisible, carouselVisible);
  const { data, loading } = useWidgetData({
    fetchFn: fetchWatchlist,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'watchlist-items',
  });
  const list = data ?? [];

  // 1-row narrow cells can't fit posters or rows — show a compact count tile
  // (same treatment as wanted-items) that jumps to the full page.
  if (narrow && (rowSpan ?? 1) <= 1) {
    return (
      <WatchlistCountTile
        count={data ? list.length : null}
        loading={loading}
        editMode={editMode}
      />
    );
  }

  const useList = narrow || layoutVariant === 'list';
  const toggleNode = !narrow && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next, { mobile: mobileGrid })}
    />
  ) : null;
  const header = (
    <SectionHeader
      title="Watchlist"
      badge={data && list.length > 0 ? <Pill color={HPR.rose}>{list.length}</Pill> : null}
      right={
        <>
          {toggleNode}
          <Link href="/watchlist" aria-label="View all" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="@max-[219px]/cell:hidden">View all </span>→
          </Link>
        </>
      }
    />
  );

  if (loading && list.length === 0) {
    return (
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {header}
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {header}
        <EmptyState>
          <Bookmark size={18} />
          Your watchlist is empty
        </EmptyState>
      </div>
    );
  }

  if (useList) {
    return (
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {header}
        <div
          className="no-scrollbar scroll-fade-y"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          {list.slice(0, visibleCount).map((item) => {
            const row = <WatchlistRow key={item.id} item={item} />;
            return editMode || !item.href ? (
              row
            ) : (
              <Link
                key={item.id}
                href={item.href}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <WatchlistRow item={item} />
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref}>
      {header}
      <div
        className="no-scrollbar"
        style={{ display: 'flex', gap: CAROUSEL_GAP, overflowX: 'auto', paddingBottom: 4 }}
      >
        {list.slice(0, visibleCount).map((item) => {
          const card = (
            <>
              <Poster
                width={CAROUSEL_CARD_WIDTH}
                height={CAROUSEL_CARD_HEIGHT}
                label={item.title}
                tone={toneFromString(item.title)}
                imageUrl={posterSrcOf(item) ?? undefined}
                timePill={formatDistanceToNowShort(item.addedAt)}
                badge={typeBadge(item.mediaType)}
              />
              <div style={{ marginTop: 6 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: HPR.fg,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontWeight: 500,
                  }}
                >
                  {item.title}
                </div>
                {item.year !== null && (
                  <div style={{ fontSize: 10, color: HPR.fgMute, fontFamily: FONT_MONO }}>
                    {item.year}
                  </div>
                )}
              </div>
            </>
          );
          return editMode || !item.href ? (
            <div key={item.id} style={{ width: CAROUSEL_CARD_WIDTH, flexShrink: 0 }}>
              {card}
            </div>
          ) : (
            <Link
              key={item.id}
              href={item.href}
              style={{
                width: CAROUSEL_CARD_WIDTH,
                flexShrink: 0,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              {card}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function WatchlistRow({ item }: { item: WatchlistWidgetItem }) {
  const badge = typeBadge(item.mediaType);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: 8,
        background: HPR.ink,
        borderRadius: 12,
      }}
    >
      <Poster
        width={48}
        height={72}
        label={item.title}
        tone={toneFromString(item.title)}
        fontSize={8}
        imageUrl={posterSrcOf(item) ?? undefined}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            color: HPR.fg,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontWeight: 500,
          }}
        >
          {item.title}
        </div>
        <div style={{ fontSize: 12, color: HPR.fgMute, fontFamily: FONT_MONO, marginTop: 2 }}>
          {item.year ?? ''}{item.year !== null ? ' · ' : ''}added {formatDistanceToNowShort(item.addedAt)}
        </div>
        {item.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4, overflow: 'hidden' }}>
            {item.tags.slice(0, 2).map((tag) => (
              <Pill key={tag.id} color={tag.color ?? HPR.fgMute} ghost>
                {tag.name}
              </Pill>
            ))}
          </div>
        )}
      </div>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          background: badge.color,
          color: 'var(--hpr-fg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginRight: 4,
          marginTop: 2,
          opacity: 0.85,
        }}
      >
        {badge.icon}
      </div>
    </div>
  );
}

function WatchlistCountTile({
  count,
  loading,
  editMode,
}: {
  count: number | null;
  loading: boolean;
  editMode: boolean;
}) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const hideIcon = width > 0 && height > 0 && (width < ICON_HIDE_THRESHOLD || height < ICON_HIDE_HEIGHT_THRESHOLD);
  const inner = (
    <div
      ref={ref}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        minWidth: 0,
        height: '100%',
      }}
    >
      {!hideIcon && (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: mix(HPR.rose, 14),
            color: HPR.rose,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Bookmark size={15} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Eyebrow>Watchlist</Eyebrow>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
          <span
            className="text-[15px] @max-[159px]/cell:text-[13px]"
            style={{
              fontFamily: FONT_DISPLAY,
              color: HPR.fg,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '-0.025em',
            }}
          >
            {count ?? (loading ? '–' : 0)}
          </span>
          <span className="min-w-0 truncate text-[10px] @max-[159px]/cell:text-[9px]" style={{ color: HPR.fgMute }}>
            saved
          </span>
        </div>
      </div>
    </div>
  );

  if (editMode) return inner;

  return (
    <Link href="/watchlist" style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>
      {inner}
    </Link>
  );
}
