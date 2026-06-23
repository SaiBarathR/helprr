'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock, Tv, Layers, CalendarClock, Hourglass, type LucideIcon } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { HPR, mix } from '@/components/widgets/bento-primitives';
import { Panel, PanelLoading, PanelEmpty } from './insights-shared';
import type { LibraryGapSectionId, LibraryGapsResponse } from '@/types';

// Ring colour by how complete the library is — mirrors the Download reliability gauge's
// good/warn/bad feel so the two read consistently.
function ringColor(pct: number): string {
  if (pct >= 90) return HPR.green;
  if (pct >= 70) return HPR.amber;
  return HPR.rose;
}

function CompletenessRing({ pct }: { pct: number }) {
  const color = ringColor(pct);
  return (
    <div
      className="relative shrink-0"
      style={{
        width: 72,
        height: 72,
        borderRadius: '50%',
        background: `conic-gradient(${color} ${pct}%, ${mix(HPR.fgMute, 18)} 0)`,
      }}
    >
      <div
        className="absolute inset-[8px] rounded-full flex flex-col items-center justify-center"
        style={{ background: HPR.surface }}
      >
        <span style={{ fontFamily: 'var(--hpr-font-display)', fontWeight: 700, fontSize: 18, color: HPR.fg, lineHeight: 1 }}>
          {pct}%
        </span>
        <span style={{ fontSize: 8, color: HPR.fgSubtle, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>
          complete
        </span>
      </div>
    </div>
  );
}

// Icon + label + accent for each gap section shown beside the ring. Mirrors SECTION_META
// on the full /library-gaps page; the accent only paints when a section has gaps so a clean
// library reads as calm grey rather than a wall of colour.
const COUNT_META: Record<LibraryGapSectionId, { label: string; icon: LucideIcon; color: string }> = {
  overdue: { label: 'Overdue', icon: Clock, color: HPR.rose },
  missingSeasons: { label: 'Missing seasons', icon: Tv, color: HPR.violet },
  collectionGaps: { label: 'Collection gaps', icon: Layers, color: HPR.blue },
  newUpcoming: { label: 'Upcoming', icon: CalendarClock, color: HPR.cyan },
  notReleased: { label: 'Not released', icon: Hourglass, color: HPR.fgMute },
};

// Order shown left-to-right, most-actionable first.
const COUNT_ORDER: LibraryGapSectionId[] = ['overdue', 'missingSeasons', 'collectionGaps', 'newUpcoming', 'notReleased'];

function CountTile({ id, count }: { id: LibraryGapSectionId; count: number }) {
  const { label, icon: Icon, color } = COUNT_META[id];
  const active = count > 0;
  return (
    <div className="flex items-center gap-2">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: mix(active ? color : HPR.fgMute, 12), color: active ? color : HPR.fgSubtle }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="flex flex-col leading-none gap-1">
        <span
          className="tabular-nums"
          style={{ fontFamily: 'var(--hpr-font-display)', fontWeight: 600, fontSize: 17, color: active ? HPR.fg : HPR.fgMute }}
        >
          {count.toLocaleString()}
        </span>
        <span className="text-[10px] uppercase tracking-wide whitespace-nowrap" style={{ color: HPR.fgMute }}>
          {label}
        </span>
      </div>
    </div>
  );
}

export function LibraryGapsCard() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.libraryGaps(),
    queryFn: jsonFetcher<LibraryGapsResponse>('/api/library-gaps'),
  });

  const byId = React.useMemo(
    () => new Map((data?.sections ?? []).map((s) => [s.id, s])),
    [data?.sections]
  );
  const completeness = data?.completeness ?? null;
  // Only surface sections whose backing service is actually connected.
  const availableCounts = COUNT_ORDER.map((id) => byId.get(id)).filter((s) => s?.available);

  const viewAll = (
    <Link
      href="/library-gaps"
      className="inline-flex items-center gap-1 text-xs hover:opacity-80 transition-opacity"
      style={{ color: HPR.fgMute }}
    >
      View all
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );

  // Per-domain rows beside the ring — only for connected services (pct returns 100 on a 0
  // total, so a row for an absent service would lie).
  const splitRows = completeness
    ? ([
        ['TV', completeness.tv],
        ['Movies', completeness.movies],
      ] as const).filter(([, s]) => s.total > 0)
    : [];

  return (
    <Panel title="Library completeness" right={viewAll}>
      {isLoading && !data ? (
        <PanelLoading height={120} />
      ) : !completeness && availableCounts.length === 0 ? (
        <PanelEmpty message="No library data available." height={120} />
      ) : (
        <div className="flex flex-col gap-4">
          {completeness && (
            <div className="flex items-center gap-3.5">
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 min-[420px]:grid-cols-3 lg:grid-cols-5">
              {availableCounts.map((section) => (
                <CountTile key={section!.id} id={section!.id} count={section!.count} />
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// Per-domain completeness for the split rows. Callers filter out absent services before rendering.
function pct({ owned, total }: { owned: number; total: number }): number | null {
  return total > 0 ? Math.round((owned / total) * 100) : null;
}
