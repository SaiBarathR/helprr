'use client';

import Link from 'next/link';
import { Search, ArrowRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { EditModePlaceholder } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';

interface WantedCounts {
  missingTotal: number;
  cutoffTotal: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchWanted(): Promise<WantedCounts> {
  const res = await fetch('/api/activity/wanted');
  if (!res.ok) {
    throw new Error(`Failed to fetch wanted counts (${res.status} ${res.statusText})`);
  }

  const data: unknown = await res.json();
  if (!isObject(data)) {
    return { missingTotal: 0, cutoffTotal: 0 };
  }

  const missingTotal = typeof data.missingTotal === 'number' ? data.missingTotal : 0;
  const cutoffTotal = typeof data.cutoffTotal === 'number' ? data.cutoffTotal : 0;
  return { missingTotal, cutoffTotal };
}

export function WantedItemsWidget({ size, refreshInterval, editMode = false }: WidgetProps) {
  const { data, loading } = useWidgetData({ fetchFn: fetchWanted, refreshInterval });

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-3">
        <Skeleton className="h-6 w-16 mb-1" />
        <Skeleton className="h-4 w-24" />
      </div>
    );
  }

  if (!data) {
    return editMode ? <EditModePlaceholder title="Wanted Items" message="No wanted counts" /> : null;
  }

  if (size === 'small') {
    return (
      <Link
        href="/activity?tab=missing"
        className="rounded-xl bg-card p-3 flex items-center gap-3 hover:bg-muted/30 active:bg-muted/50 transition-colors"
      >
        <Search className="h-4 w-4 text-amber-500" />
        <div>
          <span className="text-lg font-bold tabular-nums">{data.missingTotal}</span>
          <span className="text-xs text-muted-foreground ml-1">missing</span>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href="/activity?tab=missing"
      className="rounded-xl bg-card p-4 flex items-center gap-4 hover:bg-muted/30 active:bg-muted/50 transition-colors"
    >
      <div className="rounded-lg bg-amber-500/10 p-2.5 shrink-0">
        <Search className="h-5 w-5 text-amber-500" />
      </div>
      <div className="flex-1">
        <p className="text-xs text-muted-foreground mb-1">Wanted Items</p>
        <div className="flex items-center gap-3">
          <div>
            <span className="text-2xl font-bold tabular-nums">{data.missingTotal}</span>
            <span className="text-xs text-muted-foreground ml-1">missing</span>
          </div>
          {data.cutoffTotal > 0 && (
            <div>
              <span className="text-xl font-bold tabular-nums text-amber-400">{data.cutoffTotal}</span>
              <span className="text-xs text-muted-foreground ml-1">cutoff</span>
            </div>
          )}
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
