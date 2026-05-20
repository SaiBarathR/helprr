'use client';

import type { WidgetProps } from '@/lib/widgets/types';
import { ProwlarrChartWidgetShell } from './prowlarr-stats-shared';

export function ProwlarrQueriesByIndexerWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  return (
    <ProwlarrChartWidgetShell
      widgetId="prowlarr-queries-by-indexer"
      title="Queries by Indexer"
      selectData={(stats) =>
        [...stats.indexers]
          .filter((i) => i.numberOfQueries + i.numberOfRssQueries + i.numberOfAuthQueries > 0)
          .sort(
            (a, b) =>
              b.numberOfQueries + b.numberOfRssQueries + b.numberOfAuthQueries -
              (a.numberOfQueries + a.numberOfRssQueries + a.numberOfAuthQueries),
          )
          .map((i) => ({
            name: i.indexerName,
            Search: i.numberOfQueries,
            RSS: i.numberOfRssQueries,
            Auth: i.numberOfAuthQueries,
          }))
      }
      bars={[
        { dataKey: 'Search', color: 'var(--hpr-violet)', stackId: 'q' },
        { dataKey: 'RSS', color: 'var(--hpr-amber)', stackId: 'q' },
        { dataKey: 'Auth', color: 'var(--hpr-rose)', stackId: 'q', radius: [0, 4, 4, 0] },
      ]}
      legend={[
        { color: 'var(--hpr-violet)', label: 'Search' },
        { color: 'var(--hpr-amber)', label: 'RSS' },
        { color: 'var(--hpr-rose)', label: 'Auth' },
      ]}
      refreshInterval={refreshInterval}
      editMode={editMode}
      narrow={narrow}
    />
  );
}
