'use client';

import Link from 'next/link';
import { AlertTriangle, Eye, Flame, MinusCircle, Tag, Trash2, RotateCcw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatDistanceToNowShort } from '@/lib/format';
import { SectionHeader } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';

interface CleanupHistoryRecord {
  id: string;
  cleaner: 'queue' | 'download';
  strikeType: string | null;
  ruleId: string | null;
  ruleName: string | null;
  hash: string;
  shortHash: string;
  torrentName: string;
  reason: string;
  action: string;
  filesDeleted: boolean;
  reSearched: boolean;
  linkedArrSource: string | null;
  linkedArrTitle: string | null;
  triggeredBy: string;
  createdAt: string;
  errorMessage: string | null;
}

async function fetchCleanupHistory(): Promise<CleanupHistoryRecord[]> {
  const res = await fetch('/api/cleanup/history?pageSize=10');
  if (!res.ok) return [];
  const data = await res.json();
  return (data?.records ?? []) as CleanupHistoryRecord[];
}

function actionIcon(action: string) {
  switch (action) {
    case 'removedFromClient':
      return <Trash2 className="h-3.5 w-3.5 text-rose-400" />;
    case 'removedFromQueue':
      return <Trash2 className="h-3.5 w-3.5 text-amber-400" />;
    case 'categoryChanged':
      return <Tag className="h-3.5 w-3.5 text-blue-400" />;
    case 'skipped':
      return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />;
    case 'dryRunPreview':
      return <Eye className="h-3.5 w-3.5 text-muted-foreground" />;
    case 'failed':
      return <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />;
    case 'strikeAdded':
      return <Flame className="h-3.5 w-3.5 text-amber-400" />;
    default:
      return <Eye className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case 'removedFromClient':
      return 'Removed';
    case 'removedFromQueue':
      return 'Queue removed';
    case 'categoryChanged':
      return 'Re-categorised';
    case 'skipped':
      return 'Skipped';
    case 'dryRunPreview':
      return 'Dry-run';
    case 'failed':
      return 'Failed';
    case 'strikeAdded':
      return 'Strike';
    default:
      return action;
  }
}

export function CleanupHistoryWidget({ size, refreshInterval }: WidgetProps) {
  const { data: records, loading } = useWidgetData({
    fetchFn: fetchCleanupHistory,
    refreshInterval,
  });

  if (loading) {
    return (
      <div>
        <SectionHeader title="Cleanup History" href="/cleanup" />
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div>
        <SectionHeader title="Cleanup History" href="/cleanup" />
        <div className="rounded-xl bg-card py-6 text-center">
          <p className="text-xs text-muted-foreground">No cleanup events yet</p>
        </div>
      </div>
    );
  }

  const limit = size === 'large' ? 10 : 5;

  return (
    <div>
      <SectionHeader title="Cleanup History" href="/cleanup" />
      <div className="space-y-1">
        {records.slice(0, limit).map((r) => (
          <Link
            key={r.id}
            href="/cleanup"
            className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2 hover:bg-muted/30 transition-colors"
          >
            <span className="shrink-0">{actionIcon(r.action)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{r.torrentName}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {actionLabel(r.action)}
                {' · '}
                {r.cleaner}
                {' · '}
                {formatDistanceToNowShort(r.createdAt)}
                {size === 'large' && r.ruleName && <> · {r.ruleName}</>}
              </p>
              {size === 'large' && r.reSearched && (
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <span className="text-[9px] px-1.5 py-0 rounded bg-primary/10 text-primary inline-flex items-center gap-0.5">
                    <RotateCcw className="h-2.5 w-2.5" /> re-searched
                  </span>
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
