'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { formatBytes } from '@/lib/format';
import type { QueueItem } from '@/types';
import type { WidgetProps } from '@/lib/widgets/types';
import {
  Bar,
  FONT_DISPLAY,
  FONT_MONO,
  HPR,
  Hairline,
  Pill,
  SectionHeader,
  ViewModeToggle,
} from './bento-primitives';
import { useDashboardLayout } from './dashboard-layout-context';

const CARD_WIDTH = 200;
const CARD_GAP = 10;
const ROW_HEIGHT = 72;

type QueueWidgetItem = QueueItem & {
  source?: string;
  service?: string;
  backend?: string;
};

interface QueueApiResponse {
  records: QueueWidgetItem[];
  totalRecords: number;
}

function itemKey(item: QueueWidgetItem): string {
  return `${item.source ?? item.service ?? item.backend ?? 'unknown'}-${item.id}`;
}

async function fetchQueue(pageSize: number): Promise<QueueWidgetItem[]> {
  const res = await fetch(`/api/activity/queue?pageSize=${pageSize}`);
  if (!res.ok) return [];
  const data: QueueApiResponse = await res.json();
  return data.records || [];
}

function progressPct(item: QueueWidgetItem): number {
  if (item.size <= 0) return 0;
  return Math.max(0, Math.min(100, ((item.size - item.sizeleft) / item.size) * 100));
}

export function ActiveDownloadsWidget({
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
    rowHeight: ROW_HEIGHT,
  });
  const carouselVisible = width > 0
    ? Math.ceil(width / (CARD_WIDTH + CARD_GAP)) + 2
    : 6;
  const visibleCount = Math.max(listVisible, carouselVisible);
  // Grow the fetch with width too — a wide carousel needs more cards than a
  // tall list. Bucket to the same 20-step as useListFetchSize uses.
  const fetchPageSize = Math.max(heightFetchSize, Math.ceil(carouselVisible / 20) * 20);
  const fetchFn = useCallback(() => fetchQueue(fetchPageSize), [fetchPageSize]);
  const { data: queue, loading } = useWidgetData({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `active-downloads-${fetchPageSize}`,
  });
  const list = queue ?? [];
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
        <SectionHeader title="Active Downloads" right={toggleNode} />
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
        <SectionHeader title="Active Downloads" right={toggleNode} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
          {editMode ? 'No active downloads' : 'Queue is empty'}
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
          title="Active Downloads"
          right={
            <>
              {toggleNode}
              <Link href="/torrents" style={{ color: 'inherit', textDecoration: 'none' }}>
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
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          {list.slice(0, visibleCount).map((it, i) => {
            const pct = progressPct(it);
            return (
              <div key={itemKey(it)}>
                {i > 0 && <Hairline />}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 0',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: HPR.fg,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {it.title}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginTop: 5,
                        fontFamily: FONT_MONO,
                        fontSize: 9,
                        color: HPR.fgSubtle,
                      }}
                    >
                      <span>{formatBytes(it.size)}</span>
                      {it.timeleft && (
                        <>
                          <span>·</span>
                          <span>{it.timeleft}</span>
                        </>
                      )}
                    </div>
                    <div style={{ marginTop: 5 }}>
                      <Bar pct={pct} color={HPR.blue} height={2} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 46 }}>
                    <div
                      style={{
                        fontFamily: FONT_DISPLAY,
                        fontSize: 15,
                        color: HPR.green,
                        fontWeight: 700,
                        lineHeight: 1,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {pct.toFixed(0)}%
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref}>
      <SectionHeader
        title="Active Downloads"
        badge={<Pill color={HPR.blue}>{list.length}</Pill>}
        right={
          <>
            {toggleNode}
            <Link href="/torrents" style={{ color: 'inherit', textDecoration: 'none' }}>
              View all →
            </Link>
          </>
        }
      />
      <div
        className="no-scrollbar"
        style={{ display: 'flex', gap: CARD_GAP, overflowX: 'auto', paddingBottom: 4 }}
      >
        {list.slice(0, visibleCount).map((it) => {
          const pct = progressPct(it);
          return (
            <div
              key={itemKey(it)}
              style={{
                minWidth: 200,
                flex: '0 0 200px',
                padding: '10px 11px',
                background: HPR.ink,
                border: `1px solid ${HPR.hairline}`,
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: HPR.fg,
                  lineHeight: 1.3,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  minHeight: 28,
                }}
              >
                {it.title}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 20,
                    color: HPR.green,
                    fontWeight: 700,
                    lineHeight: 1,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {pct.toFixed(0)}%
                </div>
                {it.timeleft && (
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      color: HPR.fgMute,
                      marginLeft: 'auto',
                    }}
                  >
                    {it.timeleft}
                  </div>
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <Bar pct={pct} color={HPR.blue} height={3} />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 5,
                  fontFamily: FONT_MONO,
                  fontSize: 9,
                  color: HPR.fgSubtle,
                }}
              >
                <span>{formatBytes(it.size)}</span>
                <span>↓ {formatBytes(Math.max(0, it.size - it.sizeleft))}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
