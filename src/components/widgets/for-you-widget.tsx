'use client';
import { ApiError } from '@/lib/query-fetch';

import { useCallback } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { toCachedImageSrc } from '@/lib/image';
import type { WidgetProps } from '@/lib/widgets/types';
import type { ForYouItem, ForYouResponse } from '@/lib/recommendations/types';
import {
  CAROUSEL_CARD_HEIGHT,
  CAROUSEL_CARD_WIDTH,
  CAROUSEL_GAP,
  FONT_MONO,
  HPR,
  LIST_ROW_HEIGHT,
  Poster,
  SectionHeader,
  ViewModeToggle,
  toneFromString,
} from './bento-primitives';
import { useDashboardLayout } from './dashboard-layout-context';

async function fetchForYou(limit: number): Promise<ForYouItem[]> {
  const res = await fetch(`/api/recommendations/for-you?limit=${limit}`);
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data = (await res.json()) as ForYouResponse;
  return data.items ?? [];
}

export function ForYouWidget({
  refreshInterval,
  editMode = false,
  narrow = false,
  layoutVariant,
  instanceId,
  mobileGrid = false,
}: WidgetProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const { setWidgetLayoutOverride } = useDashboardLayout();
  const { visibleCount: listVisible, fetchSize: heightFetchSize } = useListFetchSize({
    height,
    rowHeight: LIST_ROW_HEIGHT,
  });
  const carouselVisible = width > 0
    ? Math.ceil(width / (CAROUSEL_CARD_WIDTH + CAROUSEL_GAP)) + 4
    : 12;
  const visibleCount = Math.max(listVisible, carouselVisible);
  const fetchLimit = Math.min(24, Math.max(heightFetchSize, carouselVisible));
  const fetchFn = useCallback(() => fetchForYou(fetchLimit), [fetchLimit]);
  const { data, loading } = useWidgetData({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `for-you-${fetchLimit}`,
  });

  const list = data ?? [];
  const useList = narrow || layoutVariant === 'list';
  const toggleNode = !narrow && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next, { mobile: mobileGrid })}
    />
  ) : null;

  const title = 'For You';

  if (loading && list.length === 0) {
    return (
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <SectionHeader title={title} right={toggleNode} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading recommendations…</div>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <SectionHeader title={title} right={toggleNode} />
        <div
          style={{
            fontSize: 11,
            color: HPR.fgSubtle,
            padding: '6px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Sparkles size={12} strokeWidth={2} />
          {editMode
            ? 'Pick suggestions from your library and watchlist'
            : 'Add items to Sonarr or Radarr to personalize'}
        </div>
      </div>
    );
  }

  if (useList) {
    return (
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <SectionHeader title={title} right={toggleNode} />
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
          {list.slice(0, visibleCount).map((it) =>
            editMode ? (
              <ForYouRow key={`${it.mediaType}-${it.tmdbId}`} item={it} />
            ) : (
              <Link
                key={`${it.mediaType}-${it.tmdbId}`}
                href={it.href}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <ForYouRow item={it} />
              </Link>
            ),
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref}>
      <SectionHeader title={title} right={toggleNode} />
      <div
        className="no-scrollbar"
        style={{ display: 'flex', gap: CAROUSEL_GAP, overflowX: 'auto', paddingBottom: 4 }}
      >
        {list.slice(0, visibleCount).map((it) => {
          const posterSrc = toCachedImageSrc(it.posterPath, 'tmdb') || it.posterPath;
          const card = (
            <>
              <Poster
                width={CAROUSEL_CARD_WIDTH}
                height={CAROUSEL_CARD_HEIGHT}
                label={it.title}
                tone={toneFromString(it.title)}
                imageUrl={posterSrc ?? undefined}
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
                  {it.title}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: HPR.fgMute,
                    fontFamily: FONT_MONO,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {it.year ?? ''}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: HPR.amber,
                    fontFamily: FONT_MONO,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={it.reason}
                >
                  {it.reason}
                </div>
              </div>
            </>
          );
          const key = `${it.mediaType}-${it.tmdbId}`;
          return editMode ? (
            <div key={key} style={{ width: CAROUSEL_CARD_WIDTH, flexShrink: 0 }}>
              {card}
            </div>
          ) : (
            <Link
              key={key}
              href={it.href}
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

function ForYouRow({ item }: { item: ForYouItem }) {
  const posterSrc = toCachedImageSrc(item.posterPath, 'tmdb') || item.posterPath;
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
        imageUrl={posterSrc ?? undefined}
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
        <div
          style={{
            fontSize: 12,
            color: HPR.fgMute,
            fontFamily: FONT_MONO,
            marginTop: 2,
          }}
        >
          {item.year ?? '—'} · {item.mediaType === 'movie' ? 'Movie' : 'TV'}
        </div>
        <div
          style={{
            fontSize: 11,
            color: HPR.amber,
            fontFamily: FONT_MONO,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginTop: 4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={item.reason}
        >
          {item.reason}
        </div>
      </div>
    </div>
  );
}
