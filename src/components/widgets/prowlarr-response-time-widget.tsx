'use client';

import type { WidgetProps } from '@/lib/widgets/types';
import { ProwlarrChartWidgetShell, formatMs } from './prowlarr-stats-shared';

export function ProwlarrResponseTimeWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  return (
    <ProwlarrChartWidgetShell
      widgetId="prowlarr-response-time"
      title="Response Time"
      selectData={(stats) =>
        [...stats.indexers]
          .filter((i) => i.averageResponseTime > 0)
          .sort((a, b) => b.averageResponseTime - a.averageResponseTime)
          .map((i) => ({ name: i.indexerName, Response: Math.round(i.averageResponseTime) }))
      }
      bars={[{ dataKey: 'Response', color: '#0ea5e9' }]}
      xTickFormatter={(v) => formatMs(v)}
      refreshInterval={refreshInterval}
      editMode={editMode}
      narrow={narrow}
    />
  );
}
