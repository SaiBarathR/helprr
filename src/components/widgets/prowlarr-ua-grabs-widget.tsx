'use client';

import type { WidgetProps } from '@/lib/widgets/types';
import { ProwlarrChartWidgetShell } from './prowlarr-stats-shared';

export function ProwlarrUserAgentGrabsWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  return (
    <ProwlarrChartWidgetShell
      widgetId="prowlarr-user-agent-grabs"
      title="User Agent — Grabs"
      selectData={(stats) =>
        (stats.userAgents ?? [])
          .filter((u) => u.numberOfGrabs > 0)
          .map((u) => ({ name: u.userAgent || 'Unknown', Grabs: u.numberOfGrabs }))
          .sort((a, b) => b.Grabs - a.Grabs)
          .slice(0, 10)
      }
      bars={[{ dataKey: 'Grabs', color: 'var(--hpr-green)' }]}
      emptyMessage="No user-agent grabs in this period."
      refreshInterval={refreshInterval}
      editMode={editMode}
      narrow={narrow}
    />
  );
}
