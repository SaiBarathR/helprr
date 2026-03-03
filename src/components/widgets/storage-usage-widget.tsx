'use client';

import { Database } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatBytes } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';

interface DiskInfo {
  freeSpace: number;
  totalSpace: number;
}

async function fetchStorage(): Promise<DiskInfo[]> {
  const res = await fetch('/api/services/stats');
  if (!res.ok) return [];
  const data = await res.json();
  return data.diskSpace || [];
}

export function StorageUsageWidget({ size, refreshInterval }: WidgetProps) {
  const { data: disks, loading } = useWidgetData({ fetchFn: fetchStorage, refreshInterval });

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-3">
        <Skeleton className="h-5 w-20 mb-2" />
        <Skeleton className="h-3 w-full" />
      </div>
    );
  }

  if (!disks || disks.length === 0) return null;

  const totalFree = disks.reduce((acc, d) => acc + d.freeSpace, 0);
  const totalSpace = disks.reduce((acc, d) => acc + d.totalSpace, 0);
  const usedPercent = totalSpace > 0 ? ((totalSpace - totalFree) / totalSpace) * 100 : 0;

  if (size === 'small') {
    return (
      <div className="rounded-xl bg-card p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Database className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Storage</span>
        </div>
        <p className="text-sm font-bold tabular-nums mb-1">{formatBytes(totalFree)} free</p>
        <Progress value={usedPercent} className="h-1.5" />
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-4">
      <p className="text-xs text-muted-foreground mb-3">Storage Usage</p>
      <div className="space-y-3">
        {disks.map((disk, i) => {
          const used = disk.totalSpace - disk.freeSpace;
          const percent = disk.totalSpace > 0 ? (used / disk.totalSpace) * 100 : 0;
          return (
            <div key={i}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Disk {i + 1}</span>
                <span className="tabular-nums font-medium">
                  {formatBytes(disk.freeSpace)} free / {formatBytes(disk.totalSpace)}
                </span>
              </div>
              <Progress
                value={percent}
                className={`h-2 ${percent > 90 ? '[&>div]:bg-rose-500' : percent > 75 ? '[&>div]:bg-amber-500' : ''}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
