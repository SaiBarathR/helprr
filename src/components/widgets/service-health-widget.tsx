'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { EditModePlaceholder } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';

interface ServiceStatus {
  type: string;
  name: string;
  ok: boolean;
}

async function fetchServiceHealth(): Promise<ServiceStatus[]> {
  const res = await fetch('/api/services/health');
  if (!res.ok) return [];
  return res.json();
}

export function ServiceHealthWidget({ refreshInterval, editMode = false }: WidgetProps) {
  const { data: services, loading } = useWidgetData({
    fetchFn: fetchServiceHealth,
    refreshInterval: Math.max(refreshInterval, 30000), // Don't health-check more often than 30s
  });

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-4">
        <Skeleton className="h-4 w-24 mb-3" />
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!services || services.length === 0) {
    return editMode ? <EditModePlaceholder title="Service Health" message="No services configured" /> : (
      <div className="rounded-xl bg-card p-4 text-center">
        <p className="text-xs text-muted-foreground">No services configured</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-4">
      <p className="text-xs text-muted-foreground mb-2.5">Service Health</p>
      <div className="space-y-1.5">
        {services.map((svc) => (
          <div key={svc.type + svc.name} className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${svc.ok ? 'bg-green-500' : 'bg-rose-500'}`} />
            <span className="text-sm flex-1 truncate">{svc.name}</span>
            <span className={`text-[10px] ${svc.ok ? 'text-green-400' : 'text-rose-400'}`}>
              {svc.ok ? 'Online' : 'Offline'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
