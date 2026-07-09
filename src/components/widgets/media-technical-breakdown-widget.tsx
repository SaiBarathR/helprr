'use client';

import * as React from 'react';
import type { WidgetProps } from '@/lib/widgets/types';
import type { MediaAnalysisResponse } from '@/types/insights';
import { formatBytes } from '@/lib/format';
import { HPR } from './bento-primitives';
import { InsightsWidgetFrame, gridColumns, AnalysisScopeChips, fetchMediaAnalysis } from './insights-widget-frame';
import { useWidgetFilter } from './use-widget-filter';
import { Stat } from '@/components/insights/insights-shared';
import {
  DistPanel,
  PANELS,
  fmtBitrate,
  type MediaAnalysisKindFilter,
} from '@/components/insights/technical-breakdown-card';

export function MediaTechnicalBreakdownWidget({ refreshInterval, editMode = false }: WidgetProps) {
  const [filters, setFilters] = useWidgetFilter<{ kind: MediaAnalysisKindFilter }>(
    'media-technical-breakdown',
    { kind: 'all' },
  );
  const fetchFn = React.useCallback(
    (signal?: AbortSignal) => fetchMediaAnalysis(filters.kind, signal),
    [filters.kind],
  );

  return (
    <InsightsWidgetFrame<MediaAnalysisResponse>
      title="Technical Breakdown"
      right={<AnalysisScopeChips value={filters.kind} onChange={(kind) => setFilters({ kind })} disabled={editMode} />}
      refreshInterval={refreshInterval}
      editMode={editMode}
      fetchFn={fetchFn}
      // Shared with the Quality Scores widget so both dedupe to one request when
      // their scope matches (same endpoint, same cache slot).
      cacheKey={`insights-media-analysis-${filters.kind}`}
      isEmpty={(d) => !d || d.totals.files === 0}
      emptyMessage="No media files with technical metadata found."
    >
      {(data, { width }) => {
        const statCols = gridColumns(width, 130, 4);
        const panelCols = gridColumns(width, 180, 3);
        return (
          <div className="flex flex-col gap-4">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${statCols}, minmax(0, 1fr))`,
                columnGap: 16,
                rowGap: 12,
              }}
            >
              <Stat label="Files" value={data.totals.files.toLocaleString()} />
              <Stat label="Total size" value={formatBytes(data.totals.bytes)} />
              <Stat
                label="Avg video bitrate"
                value={data.totals.avgVideoBitrate !== null ? fmtBitrate(data.totals.avgVideoBitrate) : '—'}
              />
              <Stat
                label="Movies / Episodes"
                value={`${data.totals.movies.toLocaleString()} / ${data.totals.episodes.toLocaleString()}`}
              />
            </div>

            <div className="h-px w-full" style={{ background: 'var(--hpr-hairline)' }} />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${panelCols}, minmax(0, 1fr))`,
                columnGap: 24,
                rowGap: 16,
              }}
            >
              {PANELS.map((p) => (
                <DistPanel
                  key={p.key}
                  label={p.label}
                  color={p.color}
                  entries={data.distributions[p.key]}
                  totalFiles={data.totals.files}
                />
              ))}
            </div>

            {data.partial && (
              <p className="text-[10px]" style={{ color: HPR.fgSubtle }}>
                Some series couldn&apos;t be scanned this pass — episode counts may be incomplete.
              </p>
            )}
          </div>
        );
      }}
    </InsightsWidgetFrame>
  );
}
