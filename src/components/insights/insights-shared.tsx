'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { Loader2 } from 'lucide-react';
import { SectionHeader, HPR, mix } from '@/components/widgets/bento-primitives';

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
 * loading or on error. Backed by TanStack Query: it threads the AbortSignal (a
 * stale range's response can't overwrite a newer one) and a 401 throws so the
 * global handler redirects to /login instead of silently rendering null.
 */
export function useInsightsResource<T>(url: string | null): { data: T | null; loading: boolean } {
  const query = useQuery({
    queryKey: ['insights', url],
    queryFn: jsonFetcher<T>(url ?? ''),
    enabled: url !== null,
  });
  return {
    data: url === null ? null : (query.data ?? null),
    loading: url !== null && query.isLoading,
  };
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

/** Minutes → compact human wait ("42m", "3.2h", "1.4d"). Recharts-free on purpose:
 *  shared by the pipeline card AND the eagerly-loaded dashboard widget. */
export function fmtWait(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${(mins / 60).toFixed(1)}h`;
  return `${(mins / (60 * 24)).toFixed(1)}d`;
}

// ─── SuccessRing: conic success-rate donut. Recharts-free on purpose: shared by
// the download-success card AND the eagerly-loaded reliability widget. ───
export function SuccessRing({ pct }: { pct: number }) {
  return (
    <div
      className="relative shrink-0"
      style={{
        width: 72,
        height: 72,
        borderRadius: '50%',
        background: `conic-gradient(${HPR.green} ${pct}%, ${mix(HPR.rose, 45)} 0)`,
      }}
    >
      <div
        className="absolute inset-[8px] rounded-full flex flex-col items-center justify-center"
        style={{ background: HPR.surface }}
      >
        <span style={{ fontFamily: 'var(--hpr-font-display)', fontWeight: 700, fontSize: 18, color: HPR.fg }}>
          {pct}%
        </span>
        <span style={{ fontSize: 8, color: HPR.fgSubtle, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          success
        </span>
      </div>
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
