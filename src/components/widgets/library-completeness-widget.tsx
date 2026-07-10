'use client';

import * as React from 'react';
import { ApiError } from '@/lib/query-fetch';
import type { WidgetProps } from '@/lib/widgets/types';
import type { LibraryGapsResponse } from '@/types';
import { HPR } from './bento-primitives';
import { InsightsWidgetFrame, gridColumns } from './insights-widget-frame';
import {
  CompletenessRing,
  CountTile,
  COUNT_ORDER,
  pct,
} from '@/components/insights/library-gaps-card';

async function fetchGaps(): Promise<LibraryGapsResponse> {
  const res = await fetch('/api/library-gaps');
  // Needs both Movies + Series access at the data layer; treat a 403 as an
  // empty payload (permission gap) rather than the error boundary.
  if (res.status === 403) return { sections: [] };
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  return res.json();
}

function gapsEmpty(d: LibraryGapsResponse | null): boolean {
  if (!d) return true;
  const hasCounts = COUNT_ORDER.some((id) => d.sections.find((s) => s.id === id)?.available);
  return d.completeness == null && !hasCounts;
}

export function LibraryCompletenessWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  return (
    <InsightsWidgetFrame<LibraryGapsResponse>
      title="Library Completeness"
      refreshInterval={refreshInterval}
      editMode={editMode}
      fetchFn={fetchGaps}
      cacheKey="insights-library-gaps"
      isEmpty={gapsEmpty}
      emptyMessage="No library data available."
    >
      {(data, { width }) => {
        const completeness = data.completeness ?? null;
        const byId = new Map(data.sections.map((s) => [s.id, s]));
        const availableCounts = COUNT_ORDER.map((id) => byId.get(id)).filter((s) => s?.available);
        const splitRows = completeness
          ? ([
              ['TV', completeness.tv],
              ['Movies', completeness.movies],
            ] as const).filter(([, s]) => s.total > 0)
          : [];
        // 140 fits the widest tile ("Missing seasons") without truncation.
        const tileCols = gridColumns(width, 140, narrow ? 2 : 5);
        // Stack the ring above the TV/Movies split on narrow cells.
        const stack = width < 210;

        return (
          <div className="flex flex-col gap-4">
            {completeness && (
              <div className={stack ? 'flex flex-col items-start gap-2.5' : 'flex items-center gap-3.5'}>
                <CompletenessRing pct={completeness.percent} />
                {splitRows.length > 0 && (
                  <div className="grid grid-cols-[auto_auto] gap-x-2.5 gap-y-1 text-xs">
                    {splitRows.map(([label, s]) => (
                      <React.Fragment key={label}>
                        <span style={{ color: HPR.fgMute }}>{label}</span>
                        <span className="tabular-nums text-right" style={{ color: HPR.fg }}>
                          {pct(s) != null ? `${pct(s)}%` : '—'}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            )}

            {completeness && availableCounts.length > 0 && (
              <div className="h-px w-full" style={{ background: 'var(--hpr-hairline)' }} />
            )}

            {availableCounts.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${tileCols}, minmax(0, 1fr))`,
                  columnGap: 16,
                  rowGap: 16,
                }}
              >
                {availableCounts.map((section) => (
                  <CountTile key={section!.id} id={section!.id} count={section!.count} />
                ))}
              </div>
            )}
          </div>
        );
      }}
    </InsightsWidgetFrame>
  );
}
