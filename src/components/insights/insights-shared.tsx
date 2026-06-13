'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { SectionHeader, HPR } from '@/components/widgets/bento-primitives';

// ─── Date-range type shared by the page + cards ───
export interface InsightsRange {
  /** Local YYYY-MM-DD (inclusive). */
  from: string;
  /** Local YYYY-MM-DD (inclusive). */
  to: string;
  /** Whole days from `from` through today — what Jellyfin's `days`-based routes take. */
  days: number;
}

/** Date → local YYYY-MM-DD (matches the server's getLocalDateKey output). */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2026-05-12" → "May 12" for chart axes / labels. */
export function shortDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Fetch a JSON resource whenever `url` changes. Returns null `data` while
 * loading or on error. Aborts the in-flight request on url change / unmount so a
 * stale range's response can't overwrite a newer one.
 */
export function useInsightsResource<T>(url: string | null): { data: T | null; loading: boolean } {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState<boolean>(url !== null);

  React.useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    // Drop the previous range's payload immediately so a URL→URL change shows the
    // loading state rather than briefly rendering stale data for the old range.
    setData(null);
    setLoading(true);
    fetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (controller.signal.aborted) return;
        setData(json ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setData(null);
        setLoading(false);
      });
    return () => controller.abort();
  }, [url]);

  return { data, loading };
}

// ─── Panel: the standard Insights card shell ───
export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl bg-card border p-4 ${className}`}>
      <SectionHeader title={title} right={right} />
      {children}
    </div>
  );
}

export function PanelLoading({ height = 200 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <Loader2 className="h-5 w-5 animate-spin" style={{ color: HPR.fgSubtle }} />
    </div>
  );
}

export function PanelEmpty({ message, height = 200 }: { message: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center text-center text-xs"
      style={{ height, color: HPR.fgSubtle }}
    >
      {message}
    </div>
  );
}

// ─── Stat: a display-font value over an uppercase muted label (optional `sub`) ───
export function Stat({
  label,
  value,
  sub,
  color = HPR.fg,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span style={{ fontFamily: 'var(--hpr-font-display)', fontWeight: 600, fontSize: 18, color }}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wide" style={{ color: HPR.fgMute }}>
        {label}
        {sub ? <span className="normal-case"> · {sub}</span> : null}
      </span>
    </div>
  );
}
