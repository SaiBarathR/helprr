'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GroupedSection } from '@/components/settings/grouped-section';
import { cn } from '@/lib/utils';

interface ServiceHealthStatus {
  instanceId: string;
  type: string;
  name: string;
  label: string;
  ok: boolean;
  error?: string;
}

export default function ServiceStatusPage() {
  const [statuses, setStatuses] = useState<ServiceHealthStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/services/health', { cache: 'no-store' });
      if (res.ok) setStatuses((await res.json()) as ServiceHealthStatus[]);
    } catch {
      /* leave previous */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleRefresh() {
    setRefreshing(true);
    void load();
  }

  const downCount = statuses.filter((s) => !s.ok).length;

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>

      <div className="px-4 mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Service status</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {loading
              ? 'Checking connected services…'
              : downCount > 0
                ? `${downCount} service${downCount === 1 ? '' : 's'} unreachable`
                : 'All connected services are reachable'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading} className="h-9 shrink-0">
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Re-test
        </Button>
      </div>

      {loading ? (
        <GroupedSection>
          <div className="px-4 py-8 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        </GroupedSection>
      ) : statuses.length === 0 ? (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No services to show.
          </div>
        </GroupedSection>
      ) : (
        <GroupedSection>
          {statuses.map((s) => (
            <div key={s.instanceId} className="grouped-row items-start">
              <div className="min-w-0 flex-1 pr-3">
                <div className="text-sm font-medium">
                  {s.name}
                  {s.label && s.label !== s.name && (
                    <span className="text-muted-foreground font-normal"> · {s.label}</span>
                  )}
                </div>
                {!s.ok && s.error && (
                  <div className="text-xs text-red-400/90 mt-0.5 break-words">{s.error}</div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={cn('h-2 w-2 rounded-full', s.ok ? 'bg-emerald-500' : 'bg-red-500')}
                  aria-hidden
                />
                <span className={cn('text-xs font-medium', s.ok ? 'text-emerald-400' : 'text-red-400')}>
                  {s.ok ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
          ))}
        </GroupedSection>
      )}
    </div>
  );
}
