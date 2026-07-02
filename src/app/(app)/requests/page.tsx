'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';
import { useUIStore } from '@/lib/store';
import { useCan } from '@/components/permission-provider';
import { RequestsFilterMenu } from '@/components/seerr/requests-filter-menu';
import { RequestsSortMenu } from '@/components/seerr/requests-sort-menu';
import { RequestsListWidget } from '@/components/widgets/requests-list-widget';
import { RequestsUsersWidget } from '@/components/widgets/requests-users-widget';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import type { SeerrRequestCount, SeerrUserSummary } from '@/types/seerr';

const TABS = [
  { key: 'requests' as const, label: 'Requests' },
  { key: 'users' as const, label: 'Users' },
];

export default function RequestsPage() {
  const externalUrls = useExternalUrls();
  const seerrUrl = externalUrls?.SEERR;
  const canApprove = useCan('requests.approve');

  const tab = useUIStore((s) => s.requestsTab);
  const setTab = useUIStore((s) => s.setRequestsTab);
  const filter = useUIStore((s) => s.requestsFilter);
  const setFilter = useUIStore((s) => s.setRequestsFilter);
  const requestsUserFilter = useUIStore((s) => s.requestsUserFilter);
  const setRequestsUserFilter = useUIStore((s) => s.setRequestsUserFilter);
  const requestsTypeFilter = useUIStore((s) => s.requestsTypeFilter);
  const setRequestsTypeFilter = useUIStore((s) => s.setRequestsTypeFilter);
  const requestsSort = useUIStore((s) => s.requestsSort);
  const setRequestsSort = useUIStore((s) => s.setRequestsSort);
  const requestsSortDirection = useUIStore((s) => s.requestsSortDirection);
  const setRequestsSortDirection = useUIStore((s) => s.setRequestsSortDirection);

  const handleUserClick = (user: SeerrUserSummary) => {
    setRequestsUserFilter(user.id);
    setTab('requests');
  };

  const typeFilterKey = requestsTypeFilter.length ? requestsTypeFilter.join(',') : 'all';

  const [refreshTick, setRefreshTick] = useState(0);
  const countsQuery = useQuery({
    queryKey: ['seerr', 'requests', 'count'],
    queryFn: jsonFetcher<SeerrRequestCount>('/api/seerr/requests/count'),
  });
  const counts = countsQuery.data ?? null;

  const { refreshing, refresh: handleRefresh } = useRefreshAction(async () => {
    setRefreshTick((n) => n + 1);
    await countsQuery.refetch();
  });

  const pendingBadge = useMemo(() => counts?.pending ?? 0, [counts]);

  const effectiveUserFilter = canApprove ? requestsUserFilter : null;

  return (
    <div className="animate-content-in">
      <PullToRefresh onRefresh={handleRefresh} />
      <div
        className="page-toolbar page-toolbar-flush flex items-center gap-1.5 app-chrome-bar bg-background/95 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        <div className="flex flex-1 items-center gap-0.5 rounded-lg bg-muted/50 p-0.5 sm:flex-none">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors sm:flex-none ${
                tab === t.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {t.key === 'requests' && pendingBadge > 0 ? (
                <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold tabular-nums text-amber-500">
                  {pendingBadge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {tab === 'requests' ? (
          <>
            <RequestsFilterMenu
              statusFilter={filter}
              onStatusFilterChange={setFilter}
              typeFilter={requestsTypeFilter}
              onTypeFilterChange={setRequestsTypeFilter}
              userFilter={effectiveUserFilter}
              onUserFilterChange={setRequestsUserFilter}
              showUserSection={canApprove}
            />
            <RequestsSortMenu
              sort={requestsSort}
              onSortChange={setRequestsSort}
              sortDirection={requestsSortDirection}
              onSortDirectionChange={setRequestsSortDirection}
            />
          </>
        ) : null}

        <div className="ml-auto flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleRefresh}
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

          {seerrUrl ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                  <a
                    href={seerrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open in Seerr"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open in Seerr</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div
        key={`${tab}-${effectiveUserFilter ?? 'all'}-${typeFilterKey}-${requestsSort}-${requestsSortDirection}-${refreshTick}`}
        className="pt-2"
      >
        {tab === 'requests' ? (
          <RequestsListWidget
            refreshInterval={30_000}
            filter={filter}
            requestedBy={effectiveUserFilter}
            typeFilter={requestsTypeFilter}
            sort={requestsSort}
            sortDirection={requestsSortDirection}
            hideHeader
            unbounded
          />
        ) : (
          <RequestsUsersWidget
            refreshInterval={60_000}
            hideHeader
            unbounded
            onUserClick={canApprove ? handleUserClick : undefined}
          />
        )}
      </div>
    </div>
  );
}
