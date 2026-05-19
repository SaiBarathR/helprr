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
  const hideIcon = (width || height) > 0 && (width < ICON_HIDE_THRESHOLD || height < ICON_HIDE_HEIGHT_THRESHOLD);
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
        <Eyebrow>{compact ? 'Wanted' : 'Wanted Items'}</Eyebrow>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            marginTop: 2,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: compact ? 20 : 22,
              color: HPR.fg,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '-0.025em',
            }}
          >
            {missing}
          </span>
          <span style={{ fontSize: compact ? 10 : 11, color: HPR.fgMute }}>missing</span>
          {cutoff > 0 && (
            <>
              <span
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 14,
                  color: HPR.amber,
                  fontWeight: 600,
                }}
              >
                {cutoff}
              </span>
              <span style={{ fontSize: 11, color: HPR.fgMute }}>cutoff</span>
            </>
          )}
        </div>
      </div>
      {!compact && <div style={{ color: HPR.fgSubtle, fontSize: 13, flexShrink: 0 }}>→</div>}
    </div>
  );

  return (
    <Link href="/activity?tab=missing" style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>
      {inner}
    </Link>
  );
}
