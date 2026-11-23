'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

/**
 * Why a widget has nothing it can truthfully show: the device is offline,
 * Helprr can't be reached, or its data failed to load for another reason (a
 * server error, an answer that isn't valid JSON, a bug in its fetcher).
 */
export type WidgetUnavailable = 'offline' | 'unreachable' | 'error';

interface Entry {
  state: WidgetUnavailable;
  retry: () => void;
}

type Report = (id: string, entry: Entry | null) => void;

const WidgetUnavailableContext = createContext<Report | null>(null);

/**
 * Collects the state of every useWidgetData call inside one widget, for the
 * renderer's shared cover. Any one load without data is enough: a widget
 * drawn from part of its data shows zeros and empty lists for the rest.
 * Offline wins over unreachable, which wins over a failed load: those two
 * say why the rest failed too. `retry` loads again every load that failed.
 */
export function useWidgetUnavailableReports(): {
  unavailable: WidgetUnavailable | null;
  retry: () => void;
  report: Report;
} {
  const [reports, setReports] = useState<Record<string, Entry>>({});
  const report = useCallback<Report>((id, entry) => {
    setReports((prev) => {
      if ((prev[id]?.state ?? null) === (entry?.state ?? null)) return prev;
      const next = { ...prev };
      if (entry) next[id] = entry;
      else delete next[id];
      return next;
    });
  }, []);
  const entries = Object.values(reports);
  const states = entries.map((entry) => entry.state);
  const unavailable = states.includes('offline')
    ? 'offline'
    : states.includes('unreachable') ? 'unreachable' : states.length ? 'error' : null;
  const retry = () => entries.forEach((entry) => entry.retry());
  return { unavailable, retry, report };
}

export function WidgetUnavailableProvider({ report, children }: { report: Report; children: React.ReactNode }) {
  return <WidgetUnavailableContext.Provider value={report}>{children}</WidgetUnavailableContext.Provider>;
}

/** Called by useWidgetData; outside a widget renderer (tests, other pages) it does nothing. */
export function useReportWidgetUnavailable(state: WidgetUnavailable | null, retry: () => void): void {
  const report = useContext(WidgetUnavailableContext);
  const id = useId();
  // The latest retry, without reporting again each render.
  const retryRef = useRef(retry);
  useEffect(() => {
    retryRef.current = retry;
  }, [retry]);
  useEffect(() => {
    report?.(id, state ? { state, retry: () => retryRef.current() } : null);
  }, [report, id, state]);
  useEffect(() => () => report?.(id, null), [report, id]);
}
