'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';
import { useUIStore, type RequestsFilterPreference } from '@/lib/store';
import { RequestsListWidget } from '@/components/widgets/requests-list-widget';
import { RequestsUsersWidget } from '@/components/widgets/requests-users-widget';
import type { SeerrRequestCount } from '@/types/seerr';

const TABS = [
  { key: 'requests' as const, label: 'Requests' },
  { key: 'users' as const, label: 'Users' },
];

const FILTERS: { value: RequestsFilterPreference; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'processing', label: 'Processing' },
  { value: 'available', label: 'Available' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'failed', label: 'Failed' },
  { value: 'all', label: 'All' },
];

export default function RequestsPage() {
  const externalUrls = useExternalUrls();
  const seerrUrl = externalUrls?.SEERR;

  const tab = useUIStore((s) => s.requestsTab);
  const setTab = useUIStore((s) => s.setRequestsTab);
  const filter = useUIStore((s) => s.requestsFilter);
  const setFilter = useUIStore((s) => s.setRequestsFilter);

  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const countsQuery = useQuery({
    queryKey: ['seerr', 'requests', 'count'],
    queryFn: jsonFetcher<SeerrRequestCount>('/api/seerr/requests/count'),
  });
  const counts = countsQuery.data ?? null;

  const handleRefresh = async () => {
    setRefreshing(true);
    // Bump the key so the active widget remounts and refetches in parallel.
    setRefreshTick((n) => n + 1);
    try {
      // Tie the spinner to the real count refetch so the badge can't re-enable stale.
      await countsQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const pendingBadge = useMemo(() => counts?.pending ?? 0, [counts]);

  return (
    <div className="animate-content-in">
      <div
        className="sticky z-30 -mx-2 flex items-center gap-1.5 bg-background/95 px-2 pt-1 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6"
        style={{ top: 'var(--header-height, 0px)' }}
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
          <Select value={filter} onValueChange={(v) => setFilter(v as RequestsFilterPreference)}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value} className="text-xs">
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      <div key={`${tab}-${refreshTick}`} className="pt-2">
        {tab === 'requests' ? (
          <RequestsListWidget
            refreshInterval={30_000}
            filter={filter}
            hideHeader
            unbounded
          />
        ) : (
          <RequestsUsersWidget refreshInterval={60_000} hideHeader unbounded />
        )}
      </div>
    </div>
  );
}
