'use client';
import { ApiError } from '@/lib/query-fetch';
import { Activity } from 'lucide-react';

import { useWidgetData } from '@/lib/widgets/use-widget-data';
import type { WidgetProps } from '@/lib/widgets/types';
import { withAppName } from '@/components/instance-filter';
import { Dot, Eyebrow, FONT_DISPLAY, FONT_MONO, HPR, EmptyState } from './bento-primitives';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { fetchOrOffline } from '@/lib/network-error';

interface ServiceStatus {
  instanceId: string;
  type: string;
  label: string;
  ok: boolean;
}

async function fetchServiceHealth(signal?: AbortSignal): Promise<ServiceStatus[]> {
  // A poll asks Helprr, not the browser's copy (the route allows 60 s + 120 s
  // stale): with Helprr down that copy kept reading "all online" for minutes.
  const res = await fetchOrOffline('/api/services/health', { signal, cache: 'no-cache' });
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  return res.json();
}

export function ServiceHealthWidget({ refreshInterval, narrow = false, colSpan, editMode = false }: WidgetProps) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const { data: services } = useWidgetData({
    fetchFn: fetchServiceHealth,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'service-health',
    refetchOnFocus: true,
  });

  const list = services ?? [];
  const okCount = list.filter((s) => s.ok).length;

  // A one-column phone cell (44–80px wide) cut the label and every row to
  // "s…": like the Indexers and Wanted tiles, it shows the count instead.
  if (narrow && (colSpan ?? 2) <= 1) {
    const down = list.length - okCount;
    return (
      <div ref={ref} style={{ minWidth: 0, height: '100%' }}>
        <Eyebrow
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            // The Indexers tile's step for the 44px (320) and 58px (375) cells.
            ...(width > 0 && width < 64 ? { fontSize: 8, letterSpacing: '0.04em' } : null),
          }}
        >
          Health
        </Eyebrow>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: width > 0 && width < 64 ? 16 : 20,
            color: HPR.fg,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            marginTop: 3,
            whiteSpace: 'nowrap',
          }}
        >
          {services ? `${okCount}/${list.length}` : '–'}
        </div>
        {services && list.length > 0 && (
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, fontSize: 10, color: HPR.fgMute, fontFamily: FONT_MONO }}
          >
            {/* The count already says how many are up: name what needs a look. */}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: down > 0 ? HPR.rose : HPR.green }}>
              <Dot color={down > 0 ? HPR.rose : HPR.green} size={5} />
              {down > 0 ? (
                // In the 44px (320) cell "2 down" wrapped under its dot; the red dot says it.
                <span>{down}<span className={width > 0 && width < 64 ? 'sr-only' : undefined}> down</span></span>
              ) : 'OK'}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Narrow cells drop "Service" so the label stays on one line. */}
      <Eyebrow style={{ marginBottom: 8, whiteSpace: 'nowrap' }}>
        <span className="@max-[219px]/cell:hidden">Service </span>Health · {okCount}/{list.length || 0}
      </Eyebrow>
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
        {list.length === 0 && (
          <EmptyState>
            <Activity size={18} />
            No services configured
          </EmptyState>
        )}
        {list.map((s, i) => (
          <div
            key={s.instanceId}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              padding: '6px 0',
              borderBottom: i < list.length - 1 ? `1px solid ${HPR.hairline}` : 'none',
              minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1 }}>
              <Dot color={s.ok ? HPR.green : HPR.rose} />
              <span
                style={{
                  color: HPR.fg,
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {withAppName(s.label, s.type)}
              </span>
            </div>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: s.ok ? HPR.green : HPR.rose,
                letterSpacing: '0.04em',
                flexShrink: 0,
              }}
            >
              {/* Status collapses to its symbol when the cell is too narrow for the word. */}
              {s.ok ? (
                narrow ? '●' : (
                  <>
                    <span className="@max-[179px]/cell:hidden">ONLINE</span>
                    <span className="hidden @max-[179px]/cell:inline">●</span>
                  </>
                )
              ) : narrow ? '×' : (
                <>
                  <span className="@max-[179px]/cell:hidden">OFFLINE</span>
                  <span className="hidden @max-[179px]/cell:inline">×</span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
