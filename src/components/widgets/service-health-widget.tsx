'use client';

import { useWidgetData } from '@/lib/widgets/use-widget-data';
import type { WidgetProps } from '@/lib/widgets/types';
import { Dot, Eyebrow, FONT_MONO, HPR } from './bento-primitives';

interface ServiceStatus {
  type: string;
  name: string;
  ok: boolean;
  ver?: string;
}

async function fetchServiceHealth(): Promise<ServiceStatus[]> {
  const res = await fetch('/api/services/health');
  if (!res.ok) return [];
  return res.json();
}

export function ServiceHealthWidget({ refreshInterval, narrow = false, editMode = false }: WidgetProps) {
  const { data: services } = useWidgetData({
    fetchFn: fetchServiceHealth,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'service-health',
  });

  const list = services ?? [];
  const okCount = list.filter((s) => s.ok).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Eyebrow style={{ marginBottom: 8 }}>
        Service Health · {okCount}/{list.length || 0}
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
          <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
            No services configured
          </div>
        )}
        {list.map((s, i) => (
          <div
            key={s.type + s.name}
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
                {s.name}
              </span>
              {!narrow && s.ver && (
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 9,
                    color: HPR.fgSubtle,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.ver}
                </span>
              )}
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
              {s.ok ? (narrow ? '●' : 'ONLINE') : narrow ? '×' : 'OFFLINE'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
