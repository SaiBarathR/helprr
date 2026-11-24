'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { GroupedSection } from '@/components/settings/grouped-section';
import { LogEntryRow } from '@/components/settings/arr-system-panels';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { jsonFetcher } from '@/lib/query-fetch';
import type { QbitLogLevel, QbitLogPage } from '@/lib/qbittorrent-log';

// qBittorrent's types go from Normal up to Critical; each choice shows one and
// everything above it, as a log reader usually wants.
const SHOW: { value: string; label: string; levels: QbitLogLevel[] }[] = [
  { value: 'all', label: 'Everything', levels: ['normal', 'info', 'warning', 'critical'] },
  { value: 'info', label: 'Info and up', levels: ['info', 'warning', 'critical'] },
  { value: 'warning', label: 'Warnings and up', levels: ['warning', 'critical'] },
  { value: 'critical', label: 'Critical only', levels: ['critical'] },
];

/** Torrents settings → Log (QBT-24): qBittorrent's main log, newest first, for admins. */
export default function TorrentLogPage() {
  const [show, setShow] = useState('all');
  const levels = (SHOW.find((option) => option.value === show) ?? SHOW[0]).levels.join(',');
  const query = useInfiniteQuery({
    queryKey: ['qbittorrent', 'log', levels],
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<QbitLogPage>(`/api/qbittorrent/log?levels=${levels}${pageParam === null ? '' : `&before=${pageParam}`}`)({ signal }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    staleTime: 30_000,
  });
  // A page is "older than this id", so one logged between two reads can't repeat; dedupe anyway.
  const seen = new Set<number>();
  const entries = (query.data?.pages.flatMap((page) => page.entries) ?? []).filter((entry) =>
    !seen.has(entry.id) && seen.add(entry.id));

  return (
    <div className="animate-content-in">
      <PageHeader title="qBittorrent Log" className="*:readable-column" backHref="/torrents/settings" />

      <div className="mt-3 pb-8 readable-column">
        <GroupedSection className="mb-4">
          <div className="grouped-row">
            <span className="text-sm">Show</span>
            <Select value={show} onValueChange={setShow}>
              <SelectTrigger aria-label="Show" className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHOW.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </GroupedSection>

        {query.isLoading ? (
          <PageSpinner />
        ) : query.isError ? (
          <ErrorState
            message="Could not read qBittorrent's log."
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing logged at these levels.</p>
        ) : (
          <GroupedSection
            footer="Newest first, from what qBittorrent keeps since it started. IP addresses are hidden, addresses cut to their host, and passwords, keys and magnet links removed where recognised."
          >
            {entries.map((entry) => (
              <LogEntryRow key={entry.id} entry={{ ...entry, logger: '', exception: '' }} />
            ))}
            {query.hasNextPage && (
              <div className="grouped-row justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage && <Loader2 className="animate-spin" />}
                  Load more
                </Button>
              </div>
            )}
          </GroupedSection>
        )}
      </div>
    </div>
  );
}
