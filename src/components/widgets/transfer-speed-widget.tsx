'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatBytes } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';

interface TransferInfo {
  dl_info_speed: number;
  up_info_speed: number;
  dl_info_data: number;
  up_info_data: number;
}

async function fetchTransfer(): Promise<TransferInfo> {
  const res = await fetch('/api/qbittorrent/transfer');
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
}

export function TransferSpeedWidget({ size, refreshInterval }: WidgetProps) {
  const { data, loading } = useWidgetData({
    fetchFn: fetchTransfer,
    refreshInterval: Math.min(refreshInterval, 3000), // More frequent for real-time speeds
  });

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-3">
        <Skeleton className="h-5 w-24 mb-1" />
        <Skeleton className="h-5 w-24" />
      </div>
    );
  }

  if (!data) return null;

  if (size === 'small') {
    return (
      <div className="rounded-xl bg-card p-3 space-y-1">
        <div className="flex items-center gap-1.5">
          <ArrowDown className="h-3.5 w-3.5 text-blue-400" />
          <span className="text-sm font-bold tabular-nums">{formatBytes(data.dl_info_speed)}/s</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowUp className="h-3.5 w-3.5 text-green-400" />
          <span className="text-sm font-bold tabular-nums">{formatBytes(data.up_info_speed)}/s</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-4">
      <p className="text-xs text-muted-foreground mb-2">Transfer Speed</p>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <ArrowDown className="h-4 w-4 text-blue-400" />
          <div>
            <p className="text-lg font-bold tabular-nums">{formatBytes(data.dl_info_speed)}/s</p>
            <p className="text-[10px] text-muted-foreground">{formatBytes(data.dl_info_data)} total</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ArrowUp className="h-4 w-4 text-green-400" />
          <div>
            <p className="text-lg font-bold tabular-nums">{formatBytes(data.up_info_speed)}/s</p>
            <p className="text-[10px] text-muted-foreground">{formatBytes(data.up_info_data)} total</p>
          </div>
        </div>
      </div>
    </div>
  );
}
