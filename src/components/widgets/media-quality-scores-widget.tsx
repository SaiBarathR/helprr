'use client';

import * as React from 'react';
import type { WidgetProps } from '@/lib/widgets/types';
import type { MediaAnalysisResponse } from '@/types/insights';
import { HPR, mix } from './bento-primitives';
import { InsightsWidgetFrame, AnalysisScopeChips, fetchMediaAnalysis } from './insights-widget-frame';
import { useWidgetFilter } from './use-widget-filter';
import { ScoreRing, CandidateRow } from '@/components/insights/quality-score-card';
import type { MediaAnalysisKindFilter } from '@/components/insights/technical-breakdown-card';

export function MediaQualityScoresWidget({ refreshInterval, editMode = false }: WidgetProps) {
  const [filters, setFilters] = useWidgetFilter<{ kind: MediaAnalysisKindFilter }>(
    'media-quality-scores',
    { kind: 'all' },
  );
  const fetchFn = React.useCallback(
    (signal?: AbortSignal) => fetchMediaAnalysis(filters.kind, signal),
    [filters.kind],
  );

  return (
    <InsightsWidgetFrame<MediaAnalysisResponse>
      title="Quality Scores"
      right={<AnalysisScopeChips value={filters.kind} onChange={(kind) => setFilters({ kind })} disabled={editMode} />}
      refreshInterval={refreshInterval}
      editMode={editMode}
      fetchFn={fetchFn}
      cacheKey={`insights-media-analysis-${filters.kind}`}
      isEmpty={(d) => !d || d.quality.avgScore === null}
      emptyMessage="Not enough technical metadata to score files."
    >
      {(data, { width }) => {
        const quality = data.quality;
        // isEmpty already filtered the null case, but guard explicitly instead
        // of asserting so a future isEmpty change can't crash the ring.
        if (quality.avgScore === null) return null;
        const maxBucket = Math.max(1, ...quality.histogram.map((h) => h.count));
        // Stack the ring above the histogram on narrow cells; the histogram rows
        // have a fixed min-width and would otherwise overflow beside the ring.
        const stack = width < 230;
        return (
          <div className="flex flex-col gap-4">
            <div className={stack ? 'flex flex-col gap-3' : 'flex items-center gap-4'}>
              <ScoreRing score={quality.avgScore} files={data.totals.scoredFiles} />
              <div className={`flex min-w-0 flex-col gap-1 ${stack ? 'w-full' : 'flex-1'}`}>
                {quality.histogram.map((h) => (
                  <div key={h.bucket} className="flex items-center gap-2" title={`${h.count.toLocaleString()} files`}>
                    <span className="w-12 shrink-0 text-right tabular-nums text-[10px]" style={{ color: HPR.fgMute }}>
                      {h.bucket}
                    </span>
                    <div className="h-1 flex-1 rounded-full" style={{ background: mix(HPR.fgMute, 15) }}>
                      <div
                        className="h-1 rounded-full"
                        style={{
                          width: `${Math.max((h.count / maxBucket) * 100, h.count > 0 ? 2 : 0)}%`,
                          background: HPR.violet,
                        }}
                      />
                    </div>
                    <span className="w-10 shrink-0 tabular-nums text-[10px]" style={{ color: HPR.fgMute }}>
                      {h.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {quality.upgradeCandidates.length > 0 && (
              <>
                <div className="h-px w-full" style={{ background: 'var(--hpr-hairline)' }} />
                <div>
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: HPR.fgMute }}>
                    Upgrade candidates
                  </span>
                  <div className="mt-1 divide-y" style={{ borderColor: 'var(--hpr-hairline)' }}>
                    {quality.upgradeCandidates.map((c) => (
                      <CandidateRow key={c.id} c={c} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      }}
    </InsightsWidgetFrame>
  );
}
