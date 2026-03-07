'use client';

import Link from 'next/link';
import { Layers, ArrowRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { EditModePlaceholder } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';

interface ProwlarrSummary {
  total: number;
  enabled: number;
  disabled: number;
  blocked: number;
}

async function fetchProwlarr(): Promise<ProwlarrSummary | null> {
  const [indexersRes, statusRes] = await Promise.allSettled([
    fetch('/api/prowlarr/indexers'),
    fetch('/api/prowlarr/status'),
  ]);

  if (indexersRes.status !== 'fulfilled' || !indexersRes.value.ok) return null;
  const indexers: { id: number; enable: boolean }[] = await indexersRes.value.json();
  if (!Array.isArray(indexers)) return null;

  const statuses: { providerId: number; disabledTill?: string }[] =
    statusRes.status === 'fulfilled' && statusRes.value.ok ? await statusRes.value.json() : [];
  const blockedIds = new Set(statuses.filter((s) => s.disabledTill).map((s) => s.providerId));
  const enabled = indexers.filter((i) => i.enable).length;
  const blocked = indexers.filter((i) => blockedIds.has(i.id)).length;

  return { total: indexers.length, enabled, disabled: indexers.length - enabled, blocked };
}

export function ProwlarrIndexersWidget({ size, refreshInterval, editMode = false }: WidgetProps) {
  const { data: prowlarr, loading } = useWidgetData({ fetchFn: fetchProwlarr, refreshInterval });

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-4">
        <Skeleton className="h-5 w-32 mb-2" />
        <Skeleton className="h-8 w-16" />
      </div>
    );
  }

  if (!prowlarr) {
    return editMode ? <EditModePlaceholder title="Prowlarr Indexers" message="Service unavailable" /> : null;
  }

  if (size === 'small') {
    return (
      <Link
        href="/prowlarr"
        className="rounded-xl bg-card p-3 flex items-center gap-3 hover:bg-muted/30 active:bg-muted/50 transition-colors"
      >
        <Layers className="h-4 w-4 text-violet-500" />
        <span className="text-lg font-bold tabular-nums">{prowlarr.total}</span>
        <span className="text-xs text-muted-foreground">Indexers</span>
        {prowlarr.blocked > 0 && (
          <span className="flex items-center gap-1 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            <span className="text-rose-400">{prowlarr.blocked}</span>
          </span>
        )}
      </Link>
    );
  }

  return (
    <Link
      href="/prowlarr"
      className="rounded-xl bg-card p-4 flex items-center gap-4 hover:bg-muted/30 active:bg-muted/50 transition-colors"
    >
      <div className="rounded-lg bg-violet-500/10 p-2.5 shrink-0">
        <Layers className="h-5 w-5 text-violet-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground mb-1">Prowlarr Indexers</p>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-2xl font-bold tabular-nums">{prowlarr.total}</span>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
              <span className="text-muted-foreground">{prowlarr.enabled} on</span>
            </span>
            {prowlarr.disabled > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                <span className="text-muted-foreground">{prowlarr.disabled} off</span>
              </span>
            )}
            {prowlarr.blocked > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                <span className="text-rose-400">{prowlarr.blocked} blocked</span>
              </span>
            )}
          </div>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
