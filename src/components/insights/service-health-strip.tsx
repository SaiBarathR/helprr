'use client';

import * as React from 'react';
import { Dot, HPR } from '@/components/widgets/bento-primitives';
import { useInsightsResource } from './insights-shared';

interface HealthStatus {
  instanceId: string;
  type: string;
  name: string;
  label: string;
  ok: boolean;
  error?: string;
}

export function ServiceHealthStrip() {
  // Health is a live snapshot; not range-dependent.
  const { data } = useInsightsResource<HealthStatus[]>('/api/services/health');
  const services = Array.isArray(data) ? data : [];
  if (services.length === 0) return null;

  const down = services.filter((s) => !s.ok).length;

  return (
    <div className="rounded-xl bg-card border p-3 flex items-center gap-x-4 gap-y-2 flex-wrap">
      <span
        className="text-[11px] shrink-0"
        style={{ color: down > 0 ? HPR.rose : HPR.green, fontFamily: 'var(--hpr-font-mono)' }}
      >
        {down > 0 ? `${down} down` : 'All healthy'}
      </span>
      {services.map((s) => (
        <span
          key={s.instanceId}
          className="inline-flex items-center gap-1.5 text-[11px]"
          style={{ color: HPR.fgMute }}
          title={s.ok ? `${s.label}: OK` : `${s.label}: ${s.error || 'unreachable'}`}
        >
          <Dot color={s.ok ? HPR.green : HPR.rose} size={6} pulse={!s.ok} />
          {s.label}
        </span>
      ))}
    </div>
  );
}
