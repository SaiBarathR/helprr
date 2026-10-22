'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import {
  Loader2,
  RefreshCw,
  Clock,
  SlidersHorizontal,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { invalidateActivity } from '@/lib/query-invalidation';
import { useUIStore } from '@/lib/store';
import { type InstanceOption, withAppName } from '@/components/instance-filter';
import { ActiveFilterBar, FilterDot, filterButtonLabel, type ActiveFilter } from '@/components/ui/active-filter-bar';
import { getDefaultActivitySortDirection } from '@/lib/activity-queue-sort';
import { FailedImportsTab } from './_components/failed-imports-tab';
import { QueueTab } from './_components/queue-tab';
import { ActivityLinkView, FILTER_OPTIONS, SORT_OPTIONS_BY_TAB, SortKey, TABS, TabKey, activityLinkView, isSortKey, isTabKey, writeActivityLinkView } from './_components/view-state';
import { WantedTab } from './_components/wanted-tab';

/**
 * Renders the Activity page with header controls (filter, sort, history, refresh) and tabbed views for Queue, Failed imports, Missing, and Cutoff items.
 *
 * The component manages local UI state for the active tab, refresh state, sort and filter selection, and queue count. It triggers background refresh commands for Sonarr and Radarr, navigates to history and import routes, and passes sorting/filtering props to the tab panels.
 *
 * @returns The Activity page React element
 */
export default function ActivityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const setActivityTab = useUIStore((s) => s.setActivityTab);
  const sortBy = useUIStore((s) => s.activitySortBy);
  const setSortBy = useUIStore((s) => s.setActivitySortBy);
  const sortDirection = useUIStore((s) => s.activitySortDirection);
  const setSortDirection = useUIStore((s) => s.setActivitySortDirection);
  const savedSources = useUIStore((s) => s.activityFilterBy);
  const setFilterBy = useUIStore((s) => s.setActivityFilterBy);
  const savedInstance = useUIStore((s) => s.activityInstanceFilter);
  const setInstanceFilter = useUIStore((s) => s.setActivityInstanceFilter);
  const searchParamsKey = searchParams.toString();
  // A ?source deep link (push notifications for a grab/failure) opens its own
  // view, like a Discover link: it never touches the saved filters, and changes
  // made on it stay with it (in its URL), so following one can't leave later
  // visits filtered. Local state is the render source so a change shows at once;
  // it's re-read whenever the URL changes, e.g. the nav item to plain /activity.
  const [linkView, setLinkView] = useState(() => activityLinkView(searchParams));
  const [linkViewKey, setLinkViewKey] = useState(searchParamsKey);
  if (linkViewKey !== searchParamsKey) {
    setLinkViewKey(searchParamsKey);
    setLinkView(activityLinkView(searchParams));
  }
  const sources = useMemo(() => (linkView ? linkView.sources : savedSources), [linkView, savedSources]);
  // Tab priority: an explicit ?tab (a widget or push-notification deep-link) wins
  // and is applied here on the first paint; otherwise we resume the last-used tab
  // from the persisted store after hydration (the nav item / a generic "view
  // all"). The initializer can't read the persisted store — it hydrates after the
  // first render, and reading it during render would break SSR hydration — so the
  // default here is 'queue' and the resume happens post-hydration. Local state
  // drives the render so in-page taps switch instantly.
  const [tab, setTab] = useState<TabKey>(() => {
    const t = searchParams.get('tab');
    return t && isTabKey(t) ? t : 'queue';
  });
  const [queueCount, setQueueCount] = useState(0);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  // arr instances for the per-instance filter (shown only when >1 instance).
  const { data: arrConnections = [] } = useQuery({
    // Distinct from queryKeys.instances() (['instances','all'] → /api/services); this
    // is the /api/instances connection list for the filter. Keep it from prefix-
    // overlapping the services key so the two can't cross-invalidate.
    queryKey: queryKeys.arrInstances(),
    queryFn: jsonFetcher<Array<{ id: string; label: string; type: string }>>('/api/instances'),
    select: (conns) => Array.isArray(conns)
      ? conns.filter((c) => c.type === 'SONARR' || c.type === 'RADARR' || c.type === 'LIDARR')
      : [],
    staleTime: 5 * 60_000,
  });
  const instanceOptions = useMemo<InstanceOption[]>(
    // Instance names repeat across apps ("main"), so each names its app too.
    () => arrConnections.map((c) => ({ id: c.id, label: withAppName(c.label, c.type) })),
    [arrConnections],
  );
  // A link's instance that no longer exists means every instance; a saved one
  // is reset by the effect below.
  const linkInstanceGone = linkView !== null && linkView.instance !== 'all'
    && instanceOptions.length > 0 && !instanceOptions.some((i) => i.id === linkView.instance);
  const instanceFilter = linkView ? (linkInstanceGone ? 'all' : linkView.instance) : savedInstance;

  // Drop a stale instance selection if that instance no longer exists.
  useEffect(() => {
    if (savedInstance !== 'all' && instanceOptions.length > 0 && !instanceOptions.some((i) => i.id === savedInstance)) {
      setInstanceFilter('all');
    }
  }, [instanceOptions, savedInstance, setInstanceFilter]);
  const initRef = useRef(false);
  const availableSortOptions = SORT_OPTIONS_BY_TAB[tab];

  // Reconcile each URL view: a valid ?tab wins, otherwise resume the saved tab
  // after hydration. Guarded during render so URL changes don't paint a stale tab.
  const [tabResumed, setTabResumed] = useState(false);
  const [tabViewKey, setTabViewKey] = useState(searchParamsKey);
  if (tabViewKey !== searchParamsKey || (hasHydrated && !tabResumed)) {
    setTabViewKey(searchParamsKey);
    setTabResumed(hasHydrated);
    const params = new URLSearchParams(searchParamsKey);
    const requestedTab = params.get('tab');
    const persistedTab = useUIStore.getState().activityTab;
    if (requestedTab && isTabKey(requestedTab)) {
      setTab(requestedTab);
    } else if (hasHydrated && isTabKey(persistedTab)) {
      setTab(persistedTab);
    }
  }

  useEffect(() => {
    if (!hasHydrated || initRef.current) return;
    initRef.current = true;
    const params = new URLSearchParams(searchParamsKey);
    const currentState = useUIStore.getState();
    const requestedSort = params.get('sort');
    if (requestedSort && isSortKey(requestedSort)) {
      const defaultDirection = getDefaultActivitySortDirection(requestedSort);
      if (requestedSort !== currentState.activitySortBy) {
        setSortBy(requestedSort);
      }
      if (defaultDirection !== currentState.activitySortDirection) {
        setSortDirection(defaultDirection);
      }
    }
  }, [hasHydrated, searchParamsKey, setSortBy, setSortDirection]);

  // On a link's view changes stay with the link; on a plain visit they're saved.
  function updateLinkView(next: ActivityLinkView | null) {
    setLinkView(next);
    writeActivityLinkView(next);
  }

  function updateSources(next: string[]) {
    if (linkView) updateLinkView({ ...linkView, sources: next });
    else setFilterBy(next);
  }

  function updateInstance(next: string) {
    if (linkView) updateLinkView({ ...linkView, instance: next });
    else setInstanceFilter(next);
  }

  const sourceLabel = (key: string) => FILTER_OPTIONS.find((opt) => opt.key === key)?.label ?? key;
  const selectedInstance = instanceOptions.find((option) => option.id === instanceFilter);
  const activeFilters: ActiveFilter[] = [
    ...sources.map((key) => ({
      id: `source:${key}`,
      label: sourceLabel(key),
      // Dismissing a link's last source ends its view: the saved filter applies
      // again rather than being overwritten.
      onRemove: () => {
        const rest = sources.filter((s) => s !== key);
        if (linkView && rest.length === 0) updateLinkView(null);
        else updateSources(rest);
      },
    })),
    ...(instanceFilter !== 'all'
      ? [{
        id: 'instance',
        label: selectedInstance?.label ?? 'Instance',
        onRemove: () => updateInstance('all'),
      }]
      : []),
  ];

  function clearFilters() {
    if (linkView) {
      updateLinkView({ sources: [], instance: 'all' });
      return;
    }
    setFilterBy([]);
    setInstanceFilter('all');
  }

  function handleTabChange(nextTab: TabKey) {
    if (!isTabKey(nextTab)) return;
    setTab(nextTab); // local state is the render source → the tab switches instantly
    setTabResumed(true); // don't let a late hydration resume override this
    if (!linkView) setActivityTab(nextTab); // only plain visits update the saved tab

    // Mirror the tab into the URL for deep-linking, but via history.replaceState so
    // there's no router navigation / RSC round-trip to delay the switch.
    // Read the live URL: a link view change written just before can still be
    // missing from useSearchParams.
    const params = new URLSearchParams(window.location.search);
    params.set('tab', nextTab);
    const query = params.toString();
    window.history.replaceState(null, '', query ? `/activity?${query}` : '/activity');
  }

  function handleSortSelect(nextSort: SortKey) {
    if (nextSort === sortBy) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortBy(nextSort);
    setSortDirection(getDefaultActivitySortDirection(nextSort));
  }

  /**
   * Trigger a refresh of monitored downloads in Sonarr and Radarr and notify the user of the outcome.
   *
   * While running, the component's refreshing state is set to true; it resets to false when finished.
   * On success (when the requests complete or settle) a success toast is shown; on error a failure toast is shown.
   */
  const { refreshing, refresh: handleRefreshActivity } = useRefreshAction(async () => {
    try {
      const body = JSON.stringify({ name: 'RefreshMonitoredDownloads' });
      const headers = { 'Content-Type': 'application/json' };
      const targets = arrConnections.length > 0
        ? arrConnections.map((connection) => ({ service: connection.type.toLowerCase(), instanceId: connection.id }))
        : ['sonarr', 'radarr', 'lidarr'].map((service) => ({ service, instanceId: undefined }));
      const results = await Promise.allSettled(targets.map(({ service, instanceId }) => {
        const url = `/api/${service}/command${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`;
        return fetch(url, { method: 'POST', headers, body });
      }));
      const anyOk = results.some((r) => r.status === 'fulfilled' && r.value.ok);
      if (anyOk) {
        // Pull the current queue/history/wanted now (the command keeps updating
        // server-side; the normal poll reconciles anything that lands later).
        invalidateActivity(queryClient);
        toast.success('Activity refresh triggered');
      } else {
        toast.error('Failed to refresh activity');
      }
    } catch {
      toast.error('Failed to refresh activity');
    }
  });

  return (
    <div className="flex flex-col min-h-0 animate-content-in">
      <PullToRefresh onRefresh={handleRefreshActivity} scrollContainerRef={contentScrollRef} />
      <div className="page-toolbar page-toolbar-flush flex items-center app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {/* Top bar — page name stays sr-only; toolbar space is for controls. */}
        <h1 className="sr-only">Activity</h1>
        <div className="flex items-center justify-between pt-2 md:pt-0 pb-2 md:pb-1 w-full">
          <div className="flex items-center md:gap-1 gap-2">
            {/* Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative md:h-11 md:w-11 w-7 h-7"
                  aria-label={filterButtonLabel('Filter and sort', activeFilters.length > 0)}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  <FilterDot active={activeFilters.length > 0} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Sources</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={sources.length === 0}
                  onCheckedChange={() => updateSources([])}
                  onSelect={(e) => e.preventDefault()}
                >
                  All
                </DropdownMenuCheckboxItem>
                {FILTER_OPTIONS.filter((opt) => opt.key !== 'all').map((opt) => (
                  <DropdownMenuCheckboxItem
                    key={opt.key}
                    checked={sources.includes(opt.key)}
                    onCheckedChange={() => updateSources(
                      sources.includes(opt.key)
                        ? sources.filter((s) => s !== opt.key)
                        : [...sources, opt.key]
                    )}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {opt.label}
                  </DropdownMenuCheckboxItem>
                ))}
                {/* Instance sub-filter, folded into this same dropdown to save mobile width. */}
                {instanceOptions.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Instance</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem
                      checked={instanceFilter === 'all'}
                      onCheckedChange={() => updateInstance('all')}
                      onSelect={(e) => e.preventDefault()}
                    >
                      All instances
                    </DropdownMenuCheckboxItem>
                    {instanceOptions.map((inst) => (
                      <DropdownMenuCheckboxItem
                        key={inst.id}
                        checked={instanceFilter === inst.id}
                        onCheckedChange={() => updateInstance(inst.id)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {inst.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </>
                )}
                {availableSortOptions.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={sortBy}
                    >
                      {availableSortOptions.map((opt) => {
                        const selected = sortBy === opt.key;
                        const DirectionIcon = sortDirection === 'asc' ? ArrowUp : ArrowDown;
                        return (
                          <DropdownMenuRadioItem
                            key={opt.key}
                            value={opt.key}
                            aria-label={
                              selected
                                ? `${opt.label}, ${sortDirection === 'asc' ? 'ascending' : 'descending'}. Select again to reverse.`
                                : opt.label
                            }
                            onSelect={(e) => {
                              e.preventDefault();
                              handleSortSelect(opt.key);
                            }}
                          >
                            {opt.label}
                            {selected && <DirectionIcon className="ml-auto h-3.5 w-3.5" />}
                          </DropdownMenuRadioItem>
                        );
                      })}
                    </DropdownMenuRadioGroup>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* History */}
            <Button
              variant="ghost"
              size="icon"
              className="md:h-11 md:w-11 w-7 h-7"
              onClick={() => router.push('/activity/history')}
              aria-label="History"
            >
              <Clock className="h-4 w-4" />
            </Button>

            {/* Refresh */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:h-11 md:w-11 w-7 h-7"
                  onClick={handleRefreshActivity}
                  disabled={refreshing}
                  aria-label="Refresh"
                >
                  {refreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Segmented control tabs — Radix for tab semantics + arrow-key nav */}
        <Tabs value={tab} onValueChange={(v) => isTabKey(v) && handleTabChange(v)} className="gap-0">
          <TabsList className="flex w-full h-auto bg-muted/50 p-0.5 gap-0.5">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.key}
                value={t.key}
                className="flex-1 text-xs font-medium py-1.5 px-2 data-[state=active]:shadow-sm"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <ActiveFilterBar filters={activeFilters} onClearAll={clearFilters} className="pt-2" />

      {/* Queue count */}
      {tab === 'queue' && queueCount > 0 && (
        <p className="text-xs text-muted-foreground py-2">
          {queueCount} {queueCount === 1 ? 'Task' : 'Tasks'}
        </p>
      )}

      {/* Tab content */}
      <div ref={contentScrollRef} data-scroll-restoration-key="activity-content" className="flex-1 overflow-y-auto">
        {tab === 'queue' && (
          <QueueTab
            sortBy={sortBy}
            sortDirection={sortDirection}
            filterBy={sources}
            instanceFilter={instanceFilter}
            onCountChange={setQueueCount}
          />
        )}
        {tab === 'failed' && <FailedImportsTab filterBy={sources} instanceFilter={instanceFilter} />}
        {tab === 'missing' && <WantedTab type="missing" filterBy={sources} instanceFilter={instanceFilter} />}
        {tab === 'cutoff' && <WantedTab type="cutoff" filterBy={sources} instanceFilter={instanceFilter} />}
      </div>
    </div>
  );
}
