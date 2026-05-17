'use client';

import type { WidgetProps } from '@/lib/widgets/types';
import { ProwlarrChartWidgetShell } from './prowlarr-stats-shared';

export function ProwlarrUserAgentQueriesWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  return (
    <ProwlarrChartWidgetShell
      widgetId="prowlarr-user-agent-queries"
      title="User Agent — Queries"
      selectData={(stats) =>
        (stats.userAgents ?? [])
          .filter((u) => u.numberOfQueries > 0)
          .map((u) => ({ name: u.userAgent || 'Unknown', Queries: u.numberOfQueries }))
          .sort((a, b) => b.Queries - a.Queries)
          .slice(0, 10)
      }
      bars={[{ dataKey: 'Queries', color: '#6366f1' }]}
      emptyMessage="No user-agent queries in this period."
      refreshInterval={refreshInterval}
      editMode={editMode}
      narrow={narrow}
    />
  );
}
