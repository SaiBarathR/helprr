'use client';

import type { WidgetProps } from '@/lib/widgets/types';
import { ProwlarrChartWidgetShell } from './prowlarr-stats-shared';

export function ProwlarrFailureRateWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  return (
    <ProwlarrChartWidgetShell
      widgetId="prowlarr-failure-rate"
      title="Failure Rate"
      selectData={(stats) =>
        stats.indexers
          .filter((i) => i.numberOfFailedQueries > 0 || i.numberOfFailedRssQueries > 0)
          .map((i) => {
            const total = Math.max(i.numberOfQueries + i.numberOfRssQueries, 1);
            const failed = i.numberOfFailedQueries + i.numberOfFailedRssQueries;
            return {
              name: i.indexerName,
              // Two decimals so a rare failure (1 in 5,000) doesn't read as 0%.
              'Failure %': parseFloat(((failed / total) * 100).toFixed(2)),
            };
          })
          .sort((a, b) => b['Failure %'] - a['Failure %'])
      }
      bars={[{ dataKey: 'Failure %', color: 'var(--hpr-rose)' }]}
      xTickFormatter={(v) => `${v}%`}
      emptyMessage="No failures in this period."
      refreshInterval={refreshInterval}
      editMode={editMode}
      narrow={narrow}
    />
  );
}
