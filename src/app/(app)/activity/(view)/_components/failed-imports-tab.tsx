'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { AlertTriangle, Upload, FileWarning, ExternalLink } from 'lucide-react';
import type { QueueItem } from '@/types';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher, backoffRefetchInterval } from '@/lib/query-fetch';
import { applyPendingImports, usePendingImports } from '@/lib/manual-import-tracker';
import { useCan } from '@/components/permission-provider';
import { canManualImport, getQueueMediaHref, manualImportHref, needsManualImport, statusLabel } from './queue-records';
import { TabErrorState } from './shared';

export function FailedImportsTab({ filterBy, instanceFilter }: { filterBy: string[]; instanceFilter: string }) {
  const router = useRouter();
  const canManageActivity = useCan('activity.manage');
  const pendingImports = usePendingImports();
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);

  useEffect(() => {
    // Load the configured activity refresh interval (ms); falls back to 5s.
    async function loadRefreshInterval() {
      const intervalMs = await getRefreshIntervalMs('activityRefreshIntervalSecs', 5);
      setRefreshIntervalMs(intervalMs);
    }
    loadRefreshInterval();
  }, []);

  // The server looks through every instance's whole queue for downloads waiting
  // on a manual import, however far past the Queue tab's first pages they sit.
  const queueQuery = useQuery({
    queryKey: ['activity', 'queue', 'needs-import'],
    queryFn: jsonFetcher<{ records?: (QueueItem & { source?: string })[] }>('/api/activity/queue?view=needs-import'),
    select: (d) => d.records ?? [],
    refetchInterval: backoffRefetchInterval(refreshIntervalMs),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const loading = queueQuery.isLoading;
  // Only import-blocked/stuck items, narrowed to the selected sources/instance.
  const queue = useMemo(() => {
    // An import in progress isn't a failure to act on any more.
    let failed = applyPendingImports(queueQuery.data ?? [], pendingImports).filter(needsManualImport);
    if (filterBy.length > 0) {
      failed = failed.filter((r) => r.source !== undefined && filterBy.includes(r.source));
    }
    if (instanceFilter !== 'all') {
      failed = failed.filter((r) => r.instanceId === instanceFilter);
    }
    return failed;
  }, [queueQuery.data, pendingImports, filterBy, instanceFilter]);


  if (loading) {
    return <ListSkeleton />;
  }

  if (queue.length === 0) {
    if (queueQuery.isError) {
      return <TabErrorState message="Couldn't load failed imports" onRetry={() => queueQuery.refetch()} />;
    }
    return (
      <div className="text-center py-16 text-muted-foreground">
        <FileWarning className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No failed imports</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 animate-list-in">
      {queue.map((item) => {
        const mediaHref = getQueueMediaHref(item);
        return (
          <QuickContextMenu
            key={`${item.source}-${item.instanceId ?? ''}-${item.id}`}
            label={`Actions for ${item.title}`}
            groups={[
              {
                id: 'actions',
                actions: [
                  ...(mediaHref
                    ? [{
                      id: 'open-media',
                      label: 'Open related media',
                      icon: <ExternalLink className="h-4 w-4" />,
                      href: mediaHref,
                    }]
                    : []),
                  ...(canManageActivity && canManualImport(item)
                    ? [{
                      id: 'manual-import',
                      label: 'Open Manual Import',
                      icon: <Upload className="h-4 w-4" />,
                      onSelect: () => router.push(manualImportHref(item)),
                    }]
                    : []),
                ],
              },
            ]}
          >
            <div className="rounded-xl bg-muted/30 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <Badge
                    variant="secondary"
                    className="bg-red-500/10 text-red-500 border-red-500/20 mt-1 text-[10px]"
                  >
                    <AlertTriangle className="h-3 w-3 mr-1" /> {statusLabel(item)}
                  </Badge>
                  {item.statusMessages?.map((msg, i) => (
                    <p key={i} className="text-xs text-muted-foreground mt-1 break-words">
                      {/* The *arr titles a download-level message with the download's own name: don't repeat it. */}
                      {msg.title && msg.title !== item.title ? `${msg.title}: ` : ''}{msg.messages?.join(', ')}
                    </p>
                  ))}
                </div>
                {canManageActivity && canManualImport(item) && (
                  <Button size="sm" className="shrink-0 h-8 text-xs" onClick={() => router.push(manualImportHref(item))}>
                    <Upload className="mr-1.5 h-3.5 w-3.5" /> Import
                  </Button>
                )}
              </div>
            </div>
          </QuickContextMenu>
        );
      })}
    </div>
  );
}
