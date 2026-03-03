'use client';

import Link from 'next/link';
import { Search, ArrowRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import type { WidgetProps } from '@/lib/widgets/types';

interface WantedCounts {
  missing: number;
  cutoff: number;
}

async function fetchWanted(): Promise<WantedCounts> {
  const [missingRes, cutoffRes] = await Promise.allSettled([
    fetch('/api/activity/wanted?type=missing&pageSize=1'),
    fetch('/api/activity/wanted?type=cutoff&pageSize=1'),
  ]);

  let missing = 0;
  let cutoff = 0;

  if (missingRes.status === 'fulfilled' && missingRes.value.ok) {
    const data = await missingRes.value.json();
    missing = data.totalRecords || 0;
  }
  if (cutoffRes.status === 'fulfilled' && cutoffRes.value.ok) {
    const data = await cutoffRes.value.json();
    cutoff = data.totalRecords || 0;
  }

  return { missing, cutoff };
}

export function WantedItemsWidget({ size, refreshInterval }: WidgetProps) {
  const { data, loading } = useWidgetData({ fetchFn: fetchWanted, refreshInterval });

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-3">
        <Skeleton className="h-6 w-16 mb-1" />
        <Skeleton className="h-4 w-24" />
      </div>
    );
  }

  if (!data) return null;

  if (size === 'small') {
    return (
      <Link
        href="/activity/wanted"
        className="rounded-xl bg-card p-3 flex items-center gap-3 hover:bg-muted/30 active:bg-muted/50 transition-colors"
      >
        <Search className="h-4 w-4 text-amber-500" />
        <div>
          <span className="text-lg font-bold tabular-nums">{data.missing}</span>
          <span className="text-xs text-muted-foreground ml-1">missing</span>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href="/activity/wanted"
      className="rounded-xl bg-card p-4 flex items-center gap-4 hover:bg-muted/30 active:bg-muted/50 transition-colors"
    >
      <div className="rounded-lg bg-amber-500/10 p-2.5 shrink-0">
        <Search className="h-5 w-5 text-amber-500" />
      </div>
      <div className="flex-1">
        <p className="text-xs text-muted-foreground mb-1">Wanted Items</p>
        <div className="flex items-center gap-3">
          <div>
            <span className="text-2xl font-bold tabular-nums">{data.missing}</span>
            <span className="text-xs text-muted-foreground ml-1">missing</span>
          </div>
          {data.cutoff > 0 && (
            <div>
              <span className="text-xl font-bold tabular-nums text-amber-400">{data.cutoff}</span>
              <span className="text-xs text-muted-foreground ml-1">cutoff</span>
            </div>
          )}
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
