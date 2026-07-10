'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import type { WidgetProps } from '@/lib/widgets/types';
import { AMBER_SOFT, Eyebrow, FONT_DISPLAY, HPR, ICON_HIDE_HEIGHT_THRESHOLD, ICON_HIDE_THRESHOLD } from './bento-primitives';

interface WantedCounts {
  missingTotal: number;
  cutoffTotal: number;
}

async function fetchWanted(): Promise<WantedCounts> {
  const res = await fetch('/api/activity/wanted');
  if (!res.ok) throw new Error('Failed to fetch wanted counts');
  const data = (await res.json()) as { missingTotal?: number; cutoffTotal?: number };
  return {
    missingTotal: typeof data.missingTotal === 'number' ? data.missingTotal : 0,
    cutoffTotal: typeof data.cutoffTotal === 'number' ? data.cutoffTotal : 0,
  };
}

export function WantedItemsWidget({
  refreshInterval,
  editMode = false,
  narrow = false,
}: WidgetProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const compact = narrow;
  const hideIcon = width > 0 && height > 0 && (width < ICON_HIDE_THRESHOLD || height < ICON_HIDE_HEIGHT_THRESHOLD);
  const { data, loading } = useWidgetData({
    fetchFn: fetchWanted,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'wanted-items',
  });
  const missing = data?.missingTotal ?? (loading ? '–' : 0);
  const cutoff = data?.cutoffTotal ?? 0;

  const inner = (
    <div
      ref={ref}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: compact ? 8 : 12,
        minWidth: 0,
        height: '100%',
      }}
    >
      {!hideIcon && (
        <div
          style={{
            width: compact ? 32 : 38,
            height: compact ? 32 : 38,
            borderRadius: 8,
            background: AMBER_SOFT,
            color: HPR.amber,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Search size={compact ? 15 : 18} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
        <Eyebrow>
          {compact ? (
            'Wanted'
          ) : (
            <>
              <span className="@max-[219px]/cell:hidden">Wanted Items</span>
              <span className="hidden @max-[219px]/cell:inline">Wanted</span>
            </>
          )}
        </Eyebrow>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            columnGap: 8,
            rowGap: 2,
            marginTop: 2,
            flexWrap: 'wrap',
          }}
        >
          {/* Each metric is a self-contained value+label unit so it wraps as a
              whole — the label never gets separated and clipped in tiny cells.
              In compact sizes the count drops to the small treatment (no big
              headline number) since the labels already name each data point. */}
          {/* Font sizes live in classes so tiny cells (~82px) can step the type
              down; the label truncates as a last resort — the number never does. */}
          <span className="min-w-0 max-w-full" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
            <span
              className={`${compact ? 'text-[15px]' : 'text-[22px]'} @max-[159px]/cell:text-[13px]`}
              style={{
                fontFamily: FONT_DISPLAY,
                color: HPR.fg,
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: '-0.025em',
              }}
            >
              {missing}
            </span>
            <span className={`min-w-0 truncate ${compact ? 'text-[10px]' : 'text-[11px]'} @max-[159px]/cell:text-[9px]`} style={{ color: HPR.fgMute }}>
              missing
            </span>
          </span>
          {cutoff > 0 && (
            <span className="min-w-0 max-w-full" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
              <span
                className={`${compact ? 'text-[15px]' : 'text-sm'} @max-[159px]/cell:text-[13px]`}
                style={{
                  fontFamily: FONT_DISPLAY,
                  color: HPR.amber,
                  fontWeight: compact ? 700 : 600,
                  lineHeight: 1,
                }}
              >
                {cutoff}
              </span>
              <span className={`min-w-0 truncate ${compact ? 'text-[10px]' : 'text-[11px]'} @max-[159px]/cell:text-[9px]`} style={{ color: HPR.fgMute }}>
                cutoff
              </span>
            </span>
          )}
        </div>
      </div>
      {!compact && (
        <div className="@max-[219px]/cell:hidden" style={{ color: HPR.fgSubtle, fontSize: 13, flexShrink: 0 }}>
          →
        </div>
      )}
    </div>
  );

  if (editMode) return inner;

  return (
    <Link href="/activity?tab=missing" style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>
      {inner}
    </Link>
  );
}
