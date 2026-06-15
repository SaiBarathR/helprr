'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
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
