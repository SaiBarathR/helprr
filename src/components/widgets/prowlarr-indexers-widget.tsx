'use client';

import Link from 'next/link';
import { Layers } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { getProwlarrIndexerStatusId, isProwlarrIndexerBlocked, type ProwlarrIndexerStatus } from '@/lib/prowlarr-client';
import type { WidgetProps } from '@/lib/widgets/types';
import { Dot, Eyebrow, FONT_DISPLAY, FONT_MONO, HPR, ICON_HIDE_HEIGHT_THRESHOLD, ICON_HIDE_THRESHOLD, mix } from './bento-primitives';

interface ProwlarrSummary {
  total: number;
  enabled: number;
  disabled: number;
  blocked: number;
}

async function fetchProwlarr(): Promise<ProwlarrSummary | null> {
  const [indexersRes, statusRes] = await Promise.allSettled([
    fetch('/api/prowlarr/indexers'),
    fetch('/api/prowlarr/status'),
  ]);
  if (indexersRes.status !== 'fulfilled' || !indexersRes.value.ok) return null;
  const indexers: { id: number; enable: boolean }[] = await indexersRes.value.json();
  if (!Array.isArray(indexers)) return null;
  const statuses: ProwlarrIndexerStatus[] =
    statusRes.status === 'fulfilled' && statusRes.value.ok ? await statusRes.value.json() : [];
  const blockedIds = new Set(
    statuses
      .filter((status) => isProwlarrIndexerBlocked(status))
      .map((status) => getProwlarrIndexerStatusId(status))
      .filter((id): id is number => id !== null),
  );
  const disabled = indexers.filter((i) => !i.enable).length;
  const blocked = indexers.filter((i) => i.enable && blockedIds.has(i.id)).length;
  const enabled = indexers.filter((i) => i.enable && !blockedIds.has(i.id)).length;
  return { total: indexers.length, enabled, disabled, blocked };
}

export function ProwlarrIndexersWidget({
  refreshInterval,
  editMode = false,
  narrow = false,
}: WidgetProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const compact = narrow;
  const hideIcon = (width || height) > 0 && (width < ICON_HIDE_THRESHOLD || height < ICON_HIDE_HEIGHT_THRESHOLD);
  const { data, loading } = useWidgetData({
    fetchFn: fetchProwlarr,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'prowlarr-indexers',
  });

  const total = data?.total ?? (loading ? '–' : 0);
  const on = data?.enabled ?? 0;
  const off = data?.disabled ?? 0;
  const blocked = data?.blocked ?? 0;

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
            width: compact ? 32 : 40,
            height: compact ? 32 : 40,
            borderRadius: 8,
            background: mix(HPR.violet, 12),
            color: HPR.violet,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Layers size={compact ? 14 : 18} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
        <Eyebrow
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {compact ? 'Indexers' : 'Prowlarr Indexers'}
        </Eyebrow>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            marginTop: 3,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: compact ? 20 : 22,
              color: HPR.fg,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '-0.02em',
            }}
          >
            {total}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 6,
              fontSize: 10,
              color: HPR.fgMute,
              fontFamily: FONT_MONO,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Dot color={HPR.green} size={5} /> {on}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Dot color={HPR.amber} size={5} /> {off}
            </span>
            {blocked > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Dot color={HPR.rose} size={5} /> {blocked}
              </span>
            )}
          </div>
        </div>
      </div>
      {!compact && <div style={{ color: HPR.fgSubtle, fontSize: 13, flexShrink: 0 }}>→</div>}
    </div>
  );

  return (
    <Link href="/prowlarr" style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>
      {inner}
    </Link>
  );
}
