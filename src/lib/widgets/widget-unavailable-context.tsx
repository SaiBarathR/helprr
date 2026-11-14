'use client';

import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react';

/** Why a widget has nothing it can truthfully show. */
export type WidgetUnavailable = 'offline' | 'unreachable';

type Report = (id: string, state: WidgetUnavailable | null) => void;

const WidgetUnavailableContext = createContext<Report | null>(null);

/**
 * Collects the state of every useWidgetData call inside one widget, for the
 * renderer's shared offline cover. Any one load without data is enough: a
 * widget drawn from part of its data shows zeros and empty lists for the rest.
 */
export function useWidgetUnavailableReports(): { unavailable: WidgetUnavailable | null; report: Report } {
  const [reports, setReports] = useState<Record<string, WidgetUnavailable>>({});
  const report = useCallback<Report>((id, state) => {
    setReports((prev) => {
      if ((prev[id] ?? null) === state) return prev;
      const next = { ...prev };
      if (state) next[id] = state;
      else delete next[id];
      return next;
    });
  }, []);
  const states = Object.values(reports);
  const unavailable = states.includes('offline') ? 'offline' : states.length ? 'unreachable' : null;
  return { unavailable, report };
}

export function WidgetUnavailableProvider({ report, children }: { report: Report; children: React.ReactNode }) {
  return <WidgetUnavailableContext.Provider value={report}>{children}</WidgetUnavailableContext.Provider>;
}

/** Called by useWidgetData; outside a widget renderer (tests, other pages) it does nothing. */
export function useReportWidgetUnavailable(state: WidgetUnavailable | null): void {
  const report = useContext(WidgetUnavailableContext);
  const id = useId();
  useEffect(() => {
    report?.(id, state);
  }, [report, id, state]);
  useEffect(() => () => report?.(id, null), [report, id]);
}
