'use client';
import { ApiError } from '@/lib/query-fetch';

import { useCallback } from 'react';
import Link from 'next/link';
import { Film, Tv } from 'lucide-react';
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
  FONT_MONO,
  HPR,
  LIST_ROW_HEIGHT,
  Poster,
  SectionHeader,
  ViewModeToggle,
  toneFromString,
} from './bento-primitives';
import { useDashboardLayout } from './dashboard-layout-context';

interface RecentItem {
  id: string;
  title: string;
  subtitle: string;
  type: 'movie' | 'episode';
  date: string;
  poster: string | null;
  href: string;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  return `${month} ${day}`;
}

async function fetchRecent(limit: number): Promise<RecentItem[]> {
  const res = await fetch(`/api/activity/recent?limit=${limit}`);
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export function RecentlyAddedWidget({
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
  const fetchLimit = Math.max(heightFetchSize, Math.ceil(carouselVisible / 20) * 20);
  const fetchFn = useCallback(() => fetchRecent(fetchLimit), [fetchLimit]);
  const { data, loading } = useWidgetData({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `recently-added-${fetchLimit}`,
  });
  const list = data ?? [];
  const useList = narrow || layoutVariant === 'list';
  const toggleNode = !narrow && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next, { mobile: mobileGrid })}
    />
  ) : null;

  if (loading && list.length === 0) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title="Recently Added" right={toggleNode} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title="Recently Added" right={toggleNode} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
          No recent imports
        </div>
      </div>
    );
  }

  if (useList) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader
          title="Recently Added"
          right={
            <>
              {toggleNode}
              <Link href="/activity" style={{ color: 'inherit', textDecoration: 'none' }}>
                <span className="@max-[219px]/cell:hidden">View all </span>→
              </Link>
            </>
          }
        />
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
              <RecentRow key={it.id} item={it} />
            ) : (
              <Link
                key={it.id}
                href={it.href}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <RecentRow item={it} />
              </Link>
            ),
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref}>
      <SectionHeader
        title="Recently Added"
        right={
          <>
            {toggleNode}
            <Link href="/activity" style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className="@max-[219px]/cell:hidden">View all </span>→
            </Link>
          </>
        }
      />
      <div
        className="no-scrollbar"
        style={{ display: 'flex', gap: CAROUSEL_GAP, overflowX: 'auto', paddingBottom: 4 }}
      >
        {list.slice(0, visibleCount).map((it) => {
          const posterSrc = toCachedImageSrc(it.poster, it.type === 'movie' ? 'radarr' : 'sonarr') || it.poster;
          const card = (
            <>
              <Poster
                width={CAROUSEL_CARD_WIDTH}
                height={CAROUSEL_CARD_HEIGHT}
                label={it.title}
                tone={toneFromString(it.title)}
                imageUrl={posterSrc ?? undefined}
                timePill={formatDistanceToNowShort(it.date)}
                badge={{
                  icon:
                    it.type === 'movie' ? (
                      <Film size={11} strokeWidth={2.4} />
                    ) : (
                      <Tv size={11} strokeWidth={2.4} />
                    ),
                  color: it.type === 'movie' ? HPR.blue : HPR.purple,
                }}
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
                <div style={{ fontSize: 10, color: HPR.fgMute, fontFamily: FONT_MONO }} className='line-clamp-1 md:line-clamp-2 overflow-hidden text-ellipsis'>
                  {it.subtitle}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: HPR.fgSubtle,
                    fontFamily: FONT_MONO,
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {formatShortDate(it.date)}
                </div>
              </div>
            </>
          );
          return editMode ? (
            <div key={it.id} style={{ width: CAROUSEL_CARD_WIDTH, flexShrink: 0 }}>
              {card}
            </div>
          ) : (
            <Link
              key={it.id}
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

function RecentRow({ item }: { item: RecentItem }) {
  const isMovie = item.type === 'movie';
  const typeColor = isMovie ? HPR.blue : HPR.purple;
  const posterSrc = toCachedImageSrc(item.poster, isMovie ? 'radarr' : 'sonarr') || item.poster;
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
            marginTop: 2,
            wordBreak: 'break-word',
          }}
        >
          {item.subtitle}
        </div>
        <div
          style={{
            fontSize: 12,
            color: HPR.fgMute,
            fontFamily: FONT_MONO,
            marginTop: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {formatDistanceToNowShort(item.date)}
        </div>
      </div>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          background: typeColor,
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
        {isMovie ? <Film size={11} strokeWidth={2.4} /> : <Tv size={11} strokeWidth={2.4} />}
      </div>
    </div>
  );
}
