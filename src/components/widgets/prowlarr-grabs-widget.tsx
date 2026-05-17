'use client';

import type { WidgetProps } from '@/lib/widgets/types';
import { ProwlarrChartWidgetShell } from './prowlarr-stats-shared';

export function ProwlarrGrabsByIndexerWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  return (
    <ProwlarrChartWidgetShell
      widgetId="prowlarr-grabs-by-indexer"
      title="Grabs by Indexer"
      selectData={(stats) =>
        stats.indexers
          .filter((i) => i.numberOfGrabs > 0)
          .map((i) => ({ name: i.indexerName, Grabs: i.numberOfGrabs }))
          .sort((a, b) => b.Grabs - a.Grabs)
      }
      bars={[{ dataKey: 'Grabs', color: '#10b981' }]}
      emptyMessage="No grabs in this period."
      refreshInterval={refreshInterval}
      editMode={editMode}
      narrow={narrow}
    />
  );
}
