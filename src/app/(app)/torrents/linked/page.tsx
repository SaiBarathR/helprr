'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Loader2, Plus } from 'lucide-react';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCan } from '@/components/permission-provider';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { formatDistanceToNowShort } from '@/lib/format';
import { DownloadProgressText, StatusBadge, type ManualDownloadView } from '@/components/torrents/manual-download-status';

const FILTERS = [
  { key: 'open', label: 'In progress', empty: 'Nothing is on its way.' },
  { key: 'attention', label: 'Needs attention', empty: 'Nothing needs attention.' },
  { key: 'history', label: 'History', empty: 'No finished downloads yet.' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

/** Releases sent to Sonarr/Radarr from Add Torrent, and where each stands. */
export default function LinkedDownloadsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('open');
  const canAdd = useCan('torrents.add');

  const query = useQuery({
    queryKey: queryKeys.manualDownloads(filter),
    queryFn: jsonFetcher<{ downloads: ManualDownloadView[] }>(`/api/manual-downloads?filter=${filter}`),
    // Arr moves these along on its own; history only changes when one finishes.
    refetchInterval: filter === 'history' ? false : 10_000,
  });
  const downloads = query.data?.downloads ?? [];
  const current = FILTERS.find((item) => item.key === filter)!;

  return (
    <div className="animate-content-in">
      <PageHeader
        title="Linked downloads"
        subtitle="Sent to Sonarr and Radarr"
        rightContent={canAdd ? (
          <button
            type="button"
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
            onClick={() => router.push('/torrents/add')}
            aria-label="Add Torrent"
          >
            <Plus className="h-5 w-5" />
          </button>
        ) : undefined}
      />

      <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)} className="mt-1">
        <TabsList aria-label="Linked downloads" className="flex w-full h-auto bg-muted/50 p-0.5 gap-0.5">
          {FILTERS.map((item) => (
            <TabsTrigger key={item.key} value={item.key} className="flex-1 text-xs font-medium py-1.5 px-2 data-[state=active]:shadow-sm">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-3 pb-8">
        {query.isPending ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : query.isError ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Linked downloads could not be loaded.</p>
        ) : downloads.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{current.empty}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border bg-card">
            {downloads.map((download) => (
              <li key={download.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/torrents/linked/${download.id}`)}
                  className="press-feedback flex w-full min-h-[64px] items-center gap-3 px-4 py-3 text-left"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{download.arrItemTitle}</span>
                      <StatusBadge status={download.status} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{download.releaseTitle}</p>
                    <DownloadProgressText download={download} />
                    <p className="text-xs text-muted-foreground">
                      {download.instanceLabel} · {formatDistanceToNowShort(download.updatedAt)}
                    </p>
                    {download.lastError && (
                      <p className="line-clamp-2 text-xs text-destructive">{download.lastError}</p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
