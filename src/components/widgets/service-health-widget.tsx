'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import type { WidgetProps } from '@/lib/widgets/types';

interface ServiceConnection {
  id: string;
  type: string;
  name: string;
  url: string;
  enabled: boolean;
}

interface ServiceStatus {
  type: string;
  name: string;
  ok: boolean;
}

async function fetchServiceHealth(): Promise<ServiceStatus[]> {
  const res = await fetch('/api/services');
  if (!res.ok) return [];
  const services: ServiceConnection[] = await res.json();

  const results: ServiceStatus[] = [];
  for (const svc of services) {
    if (!svc.enabled) continue;
    const name = svc.name || svc.type;
    try {
      // Use the stats endpoint as a lightweight health check
      const testRes = await fetch('/api/services/stats', { signal: AbortSignal.timeout(5000) });
      results.push({ type: svc.type, name, ok: testRes.ok });
    } catch {
      results.push({ type: svc.type, name, ok: false });
    }
  }
  return results;
}

export function ServiceHealthWidget({ size, refreshInterval }: WidgetProps) {
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
    return (
      <div className="rounded-xl bg-card p-4 text-center">
        <p className="text-xs text-muted-foreground">No services configured</p>
      </div>
    );
  }

  if (size === 'small') {
    const allOk = services.every((s) => s.ok);
    const downCount = services.filter((s) => !s.ok).length;
    return (
      <div className="rounded-xl bg-card p-3 flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full ${allOk ? 'bg-green-500' : 'bg-rose-500'}`} />
        <div>
          <p className="text-sm font-medium">{allOk ? 'All services up' : `${downCount} down`}</p>
          <p className="text-[10px] text-muted-foreground">{services.length} services</p>
        </div>
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
