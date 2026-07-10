'use client';
import { ApiError } from '@/lib/query-fetch';

import { useCallback } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, RotateCw, Trash2 } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { formatDistanceToNowShort } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';
import { FONT_MONO, HPR, Hairline, SectionHeader, mix } from './bento-primitives';

const ROW_HEIGHT = 46;

interface CleanupHistoryRecord {
  id: string;
  cleaner: 'queue' | 'download';
  ruleName: string | null;
  torrentName: string;
  action: string;
  reSearched: boolean;
  createdAt: string;
}

async function fetchCleanupHistory(pageSize: number): Promise<CleanupHistoryRecord[]> {
  const res = await fetch(`/api/cleanup/history?pageSize=${pageSize}`);
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data = await res.json();
  return (data?.records ?? []) as CleanupHistoryRecord[];
}

function actionLabel(action: string): string {
  switch (action) {
    case 'removedFromClient': return 'Removed';
    case 'removedFromQueue': return 'Queue removed';
    case 'categoryChanged': return 'Re-categorised';
    case 'skipped': return 'Skipped';
    case 'dryRunPreview': return 'Dry-run';
    case 'failed': return 'Failed';
    case 'strikeAdded': return 'Strike';
    default: return action;
  }
}

function actionColor(action: string): string {
  if (action === 'strikeAdded') return HPR.amber;
  if (action === 'failed' || action === 'removedFromClient') return HPR.rose;
  if (action === 'categoryChanged') return HPR.blue;
  return HPR.fgMute;
}

function ActionIcon({ action }: { action: string }) {
  if (action === 'strikeAdded') return <AlertTriangle size={12} strokeWidth={2.4} />;
  if (action === 'failed') return <AlertCircle size={12} strokeWidth={2.4} />;
  return <Trash2 size={12} strokeWidth={2.2} />;
}

export function CleanupHistoryWidget({
  refreshInterval,
  editMode = false,
  rowSpan = 2,
}: WidgetProps) {
  const { ref, height } = useElementSize<HTMLDivElement>();
  const { visibleCount, fetchSize: fetchPageSize } = useListFetchSize({
    height,
    rowHeight: ROW_HEIGHT,
    bucketSize: 5,
  });
  const fetchFn = useCallback(() => fetchCleanupHistory(fetchPageSize), [fetchPageSize]);
  const { data, loading } = useWidgetData({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `cleanup-history-${fetchPageSize}`,
  });
  const list = data ?? [];

  if (loading && list.length === 0) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title="Cleanup History" />
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
        <SectionHeader title="Cleanup History" />
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
          No cleanup events yet
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <SectionHeader
        title="Cleanup History"
        right={
          <Link href="/cleanup" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="@max-[219px]/cell:hidden">View all </span>→
          </Link>
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
        {list.slice(0, visibleCount).map((r, i) => {
          const color = actionColor(r.action);
          const inner = (
            <div
              className="gap-2.5 @max-[219px]/cell:gap-2"
              style={{ display: 'flex', alignItems: 'center', padding: '8px 0' }}
            >
              {/* Action icon is decoration (label repeats it) — dropped on tiny cells. */}
              <div
                className="flex items-center justify-center @max-[159px]/cell:hidden"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  background: mix(color, 14),
                  color,
                  flexShrink: 0,
                }}
              >
                <ActionIcon action={r.action} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: HPR.fg,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {r.torrentName}
                </div>
                {/* Full meta on regular cells; compact cells drop the cleaner leg,
                    rule name and "ago" so action + timestamp stay fully readable. */}
                <div
                  className="@max-[219px]/cell:hidden"
                  style={{
                    fontSize: 9,
                    color: HPR.fgMute,
                    fontFamily: FONT_MONO,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {actionLabel(r.action)} · {r.cleaner} · {formatDistanceToNowShort(r.createdAt)} ago
                  {rowSpan >= 2 && r.ruleName ? ` · ${r.ruleName}` : ''}
                </div>
                <div
                  className="hidden @max-[219px]/cell:block"
                  style={{
                    fontSize: 9,
                    color: HPR.fgMute,
                    fontFamily: FONT_MONO,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {actionLabel(r.action)} · {formatDistanceToNowShort(r.createdAt)}
                </div>
                {rowSpan >= 2 && r.reSearched && (
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 8,
                      fontFamily: FONT_MONO,
                      color: HPR.cyan,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: mix(HPR.cyan, 12),
                    }}
                  >
                    <RotateCw size={8} strokeWidth={2.4} /> re-searched
                  </div>
                )}
              </div>
            </div>
          );
          return (
            <div key={r.id}>
              {i > 0 && <Hairline />}
              {editMode ? (
                inner
              ) : (
                <Link href="/cleanup" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                  {inner}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
