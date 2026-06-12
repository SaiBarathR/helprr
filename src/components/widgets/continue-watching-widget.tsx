'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { useCan } from '@/components/permission-provider';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import type { JellyfinItem } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';
import {
  Bar,
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

async function fetchResumeItems(limit: number): Promise<JellyfinItem[]> {
  const res = await fetch(`/api/jellyfin/resume?limit=${limit}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

function jellyfinWebUrl(baseUrl: string, item: JellyfinItem): string {
  const targetId = item.Type === 'Episode' && item.SeriesId ? item.SeriesId : item.Id;
  return `${baseUrl}/web/index.html#!/details?id=${targetId}`;
}

function watchUrl(item: JellyfinItem): string {
  const ticks = item.UserData?.PlaybackPositionTicks ?? 0;
  return ticks > 0 ? `/watch/${item.Id}?t=${ticks}` : `/watch/${item.Id}`;
}

export function ContinueWatchingWidget({
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
    bucketSize: 10,
  });
  const carouselVisible = width > 0
    ? Math.ceil(width / (CAROUSEL_CARD_WIDTH + CAROUSEL_GAP)) + 4
    : 12;
  const visibleCount = Math.max(listVisible, carouselVisible);
  const fetchLimit = Math.max(heightFetchSize, Math.ceil(carouselVisible / 10) * 10);
  const fetchFn = useCallback(() => fetchResumeItems(fetchLimit), [fetchLimit]);
  const { data: items, loading } = useWidgetData({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `continue-watching-${fetchLimit}`,
  });
  const externalUrls = useExternalUrls();
  const jellyfinUrl = externalUrls.JELLYFIN;
  const canPlay = useCan('jellyfin.play');

  const list = items ?? [];
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
        <SectionHeader title="Continue Watching" right={toggleNode} />
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
        <SectionHeader title="Continue Watching" right={toggleNode} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
          {editMode ? 'Nothing to resume' : 'No items in progress'}
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
          title="Continue Watching"
          right={
            <>
              {toggleNode}
              <Link href="/jellyfin" style={{ color: 'inherit', textDecoration: 'none' }}>
                View all →
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
          {list.slice(0, visibleCount).map((it) => {
            const pct = it.UserData?.PlayedPercentage ?? 0;
            const title = it.SeriesName || it.Name;
            const sub =
              it.Type === 'Episode' && it.ParentIndexNumber != null
                ? `S${it.ParentIndexNumber}·E${it.IndexNumber ?? ''}`
                : it.ProductionYear?.toString() ?? '';
            const imageId = it.Type === 'Episode' && it.SeriesId ? it.SeriesId : it.Id;
            const hasImage = it.ImageTags?.Primary || (it.Type === 'Episode' && it.SeriesId);
            const imageSrc = hasImage
              ? `/api/jellyfin/image?itemId=${imageId}&type=Primary&maxWidth=120&quality=80`
              : undefined;
            const row = (
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
                  label={title}
                  tone={toneFromString(title)}
                  fontSize={8}
                  imageUrl={imageSrc}
                  progress={pct}
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
                    {title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: HPR.fgMute,
                      fontFamily: FONT_MONO,
                      marginTop: 2,
                      wordBreak: 'break-word',
                    }}
                  >
                    {sub}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Bar pct={pct} color={HPR.cyan} height={3} />
                  </div>
                </div>
              </div>
            );
            if (canPlay && !editMode) {
              // Resume in the in-app player; JF web stays as a corner affordance.
              return (
                <div key={it.Id} style={{ position: 'relative' }}>
                  <Link
                    href={watchUrl(it)}
                    style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                  >
                    {row}
                  </Link>
                  {jellyfinUrl && (
                    <a
                      href={jellyfinWebUrl(jellyfinUrl, it)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open in Jellyfin"
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        padding: 4,
                        display: 'inline-flex',
                        color: HPR.fgSubtle,
                      }}
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              );
            }
            return jellyfinUrl && !editMode ? (
              <a
                key={it.Id}
                href={jellyfinWebUrl(jellyfinUrl, it)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                {row}
              </a>
            ) : (
              <div key={it.Id}>{row}</div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref}>
      <SectionHeader
        title="Continue Watching"
        right={
          <>
            {toggleNode}
            <Link href="/jellyfin" style={{ color: 'inherit', textDecoration: 'none' }}>
              View all →
            </Link>
          </>
        }
      />
      <div
        className="no-scrollbar"
        style={{ display: 'flex', gap: CAROUSEL_GAP, overflowX: 'auto', paddingBottom: 4 }}
      >
        {list.slice(0, visibleCount).map((it) => {
          const pct = it.UserData?.PlayedPercentage ?? 0;
          const title = it.SeriesName || it.Name;
          const sub =
            it.Type === 'Episode' && it.ParentIndexNumber != null
              ? `S${it.ParentIndexNumber}·E${it.IndexNumber ?? ''}`
              : it.ProductionYear?.toString() ?? '';
          const imageId = it.Type === 'Episode' && it.SeriesId ? it.SeriesId : it.Id;
          const hasImage = it.ImageTags?.Primary || (it.Type === 'Episode' && it.SeriesId);
          const imageSrc = hasImage
            ? `/api/jellyfin/image?itemId=${imageId}&type=Primary&maxWidth=220&quality=90`
            : undefined;
          const cardInner = (
            <>
              <Poster
                width={CAROUSEL_CARD_WIDTH}
                height={CAROUSEL_CARD_HEIGHT}
                label={title}
                tone={toneFromString(title)}
                progress={pct}
                imageUrl={imageSrc}
              />
              <div
                style={{
                  fontSize: 11,
                  color: HPR.fg,
                  marginTop: 6,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontWeight: 500,
                }}
              >
                {title}
              </div>
              <div style={{ fontSize: 10, color: HPR.fgMute, fontFamily: FONT_MONO }}>{sub}</div>
            </>
          );
          if (canPlay && !editMode) {
            // Resume in the in-app player; JF web stays as a corner affordance.
            return (
              <div
                key={it.Id}
                style={{ width: CAROUSEL_CARD_WIDTH, flexShrink: 0, position: 'relative' }}
              >
                <Link
                  href={watchUrl(it)}
                  style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                >
                  {cardInner}
                </Link>
                {jellyfinUrl && (
                  <a
                    href={jellyfinWebUrl(jellyfinUrl, it)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open in Jellyfin"
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      padding: 4,
                      display: 'inline-flex',
                      color: '#fff',
                      background: 'rgba(0,0,0,0.55)',
                      borderRadius: 999,
                    }}
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            );
          }
          return jellyfinUrl && !editMode ? (
            <a
              key={it.Id}
              href={jellyfinWebUrl(jellyfinUrl, it)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                width: CAROUSEL_CARD_WIDTH,
                flexShrink: 0,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              {cardInner}
            </a>
          ) : (
            <div key={it.Id} style={{ width: CAROUSEL_CARD_WIDTH, flexShrink: 0 }}>
              {cardInner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
