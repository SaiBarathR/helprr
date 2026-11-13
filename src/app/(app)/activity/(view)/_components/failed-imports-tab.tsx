'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
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
import { queryKeys } from '@/lib/query-keys';
import { applyPendingImports, usePendingImports } from '@/lib/manual-import-tracker';
import { useCan } from '@/components/permission-provider';
import { canManualImport, getQueueMediaHref, manualImportHref, needsManualImport, statusLabel } from './queue-records';
import { TabErrorState } from './shared';
import { HistoryEventDrawer, HistoryEventRow, type HistoryRecord } from './history-event';

const RECENT_FAILURE_DAYS = 7;

// History's failed events for the selected sources/instance, one bounded page
// (the newest 50) per request; the 7-day cutoff is applied here. Sonarr/Radarr
// filter by event upstream, but Lidarr can't, so finding its failures pages
// through its whole history: it's asked only when chosen (a Lidarr push links
// with ?source=lidarr) or its instance is.
function recentFailureUrls(filterBy: string[], instanceFilter: string): string[] {
  const base = { page: '1', pageSize: '50', eventType: 'failed' };
  if (instanceFilter !== 'all') {
    return [`/api/activity/history?${new URLSearchParams({ ...base, instanceId: instanceFilter })}`];
  }
  const sources = filterBy.length > 0 ? filterBy : ['sonarr', 'radarr'];
  return sources.map((source) => `/api/activity/history?${new URLSearchParams({ ...base, source })}`);
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">{children}</h2>;
}

/**
 * The last week's failed downloads, as the History page shows them. A
 * downloadFailed push links here with ?focus=<downloadId>, which opens that
 * failure's detail sheet once it has loaded.
 */
function RecentFailures({ filterBy, instanceFilter }: { filterBy: string[]; instanceFilter: string }) {
  const focusId = useSearchParams().get('focus');
  const [selected, setSelected] = useState<HistoryRecord | null>(null);
  const [handledFocusId, setHandledFocusId] = useState<string | null>(null);
  const urls = recentFailureUrls(filterBy, instanceFilter);
  const failuresQuery = useQuery({
    queryKey: ['activity', 'history', 'recent-failures', urls],
    queryFn: async ({ signal }) => {
      type Page = { records?: HistoryRecord[]; partial?: boolean };
      const results = await Promise.allSettled(urls.map((url) => jsonFetcher<Page>(url)({ signal })));
      const pages = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      // One app being down mustn't hide the others' failures.
      if (pages.length === 0) throw (results[0] as PromiseRejectedResult).reason;
      const since = Date.now() - RECENT_FAILURE_DAYS * 24 * 60 * 60 * 1000;
      const records = pages
        .flatMap((page) => page.records ?? [])
        .filter((r) => Date.parse(r.date) >= since)
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      return { records, incomplete: pages.length < results.length || pages.some((page) => page.partial) };
    },
    // A pushed failure may be newer than cached data: look again before giving up on it.
    refetchOnMount: focusId ? 'always' : true,
  });
  // Lidarr is left out unless chosen (see recentFailureUrls), so say so when it's set up.
  const { data: hasLidarr = false } = useQuery({
    queryKey: queryKeys.arrInstances(),
    queryFn: jsonFetcher<Array<{ type: string }>>('/api/instances'),
    select: (conns) => Array.isArray(conns) && conns.some((c) => c.type === 'LIDARR'),
    staleTime: 5 * 60_000,
  });
  // Only for those who can choose Lidarr in the filter: without music.view it isn't offered.
  const canViewMusic = useCan('music.view');
  const lidarrSkipped = canViewMusic && hasLidarr && filterBy.length === 0 && instanceFilter === 'all';
  const failures = useMemo(
    () => (failuresQuery.data?.records ?? []).filter(
      (r) => filterBy.length === 0 || (r.source !== undefined && filterBy.includes(r.source)),
    ),
    [failuresQuery.data, filterBy],
  );

  // One-shot per focus id, on fresh data: open the pushed failure if it's
  // listed, else give up.
  if (focusId && handledFocusId !== focusId && failuresQuery.isFetchedAfterMount && !failuresQuery.isFetching) {
    setHandledFocusId(focusId);
    const match = failures.find((r) => r.downloadId === focusId);
    if (match) setSelected(match);
  }

  // Drop a handled focus from the URL, so coming back to this tab (another tab
  // and back, or Back from a link in the sheet) doesn't open the sheet again.
  useEffect(() => {
    if (!handledFocusId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('focus') !== handledFocusId) return;
    params.delete('focus');
    const query = params.toString();
    window.history.replaceState(null, '', query ? `/activity?${query}` : '/activity');
  }, [handledFocusId]);

  let content: ReactNode;
  if (failuresQuery.isLoading) {
    content = <ListSkeleton count={2} />;
  } else if (failuresQuery.isError) {
    content = <TabErrorState message="Couldn't load recent failures" onRetry={() => failuresQuery.refetch()} />;
  } else if (failures.length === 0) {
    content = <p className="py-4 text-center text-sm text-muted-foreground">No failed downloads in the last {RECENT_FAILURE_DAYS} days</p>;
  } else {
    content = (
      <div className="space-y-1 animate-list-in">
        {failures.map((item, i) => (
          <HistoryEventRow
            key={`${item.source}-${item.instanceId ?? ''}-${item.id}-${i}`}
            item={item}
            onSelect={() => setSelected(item)}
          />
        ))}
      </div>
    );
  }

  return (
    <section>
      <SectionHeading>Recent failures</SectionHeading>
      {content}
      {failuresQuery.data?.incomplete && (
        <p className="px-3 py-2 text-center text-xs text-amber-400">
          Some history couldn&apos;t be checked, so this list may be incomplete.
        </p>
      )}
      {lidarrSkipped && (
        <p className="px-3 py-2 text-center text-xs text-muted-foreground">
          Lidarr failures show when Lidarr is chosen in the filter.
        </p>
      )}
      <HistoryEventDrawer item={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

/**
 * Render the Needs import tab (URL value `failed`, kept for existing links): the last week's failed
 * downloads from History, then the queue items that need a manual import.
 *
 * @param filterBy - Selected sources to apply (`'sonarr'`, `'radarr'`, `'lidarr'`); an empty array means all sources.
 * @returns The tab content JSX: the Recent failures and Needs import sections
 */
export function FailedImportsTab({ filterBy, instanceFilter }: { filterBy: string[]; instanceFilter: string }) {
  return (
    <div className="space-y-5">
      <RecentFailures filterBy={filterBy} instanceFilter={instanceFilter} />
      <section>
        <SectionHeading>Needs import</SectionHeading>
        <NeedsImportList filterBy={filterBy} instanceFilter={instanceFilter} />
      </section>
    </div>
  );
}

/**
 * The queue items that failed import, each with a manual import action.
 *
 * Shows loading skeletons while fetching; if nothing needs an import it renders an empty-state message;
 * otherwise it renders each item with its messages and an Import button that navigates to the manual import page.
 */
function NeedsImportList({ filterBy, instanceFilter }: { filterBy: string[]; instanceFilter: string }) {
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
      <div className="text-center py-8 text-muted-foreground">
        <FileWarning className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Nothing needs a manual import</p>
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
