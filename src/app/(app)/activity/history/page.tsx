'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Filter, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { HistoryItem } from '@/types';

// --- Event type config ---

type EventFilterKey = 'all' | 'grabbed' | 'downloadFolderImported' | 'downloadFailed' | 'downloadIgnored' | 'renamed' | 'episodeFileDeleted' | 'movieFileDeleted';

interface EventFilterOption {
  key: EventFilterKey;
  label: string;
}

const EVENT_FILTERS: EventFilterOption[] = [
  { key: 'all', label: 'All Events' },
  { key: 'grabbed', label: 'Grabbed' },
  { key: 'downloadFolderImported', label: 'Imported' },
  { key: 'downloadFailed', label: 'Failed' },
  { key: 'downloadIgnored', label: 'Ignored' },
  { key: 'renamed', label: 'Renamed' },
  { key: 'episodeFileDeleted', label: 'Deleted' },
];

// --- Instance filter ---

type InstanceFilter = 'all' | 'sonarr' | 'radarr';

const INSTANCE_OPTIONS: { key: InstanceFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sonarr', label: 'Sonarr' },
  { key: 'radarr', label: 'Radarr' },
];

// --- Event styling ---

function eventColor(eventType: string) {
  switch (eventType) {
    case 'grabbed':
      return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    case 'downloadFolderImported':
    case 'episodeFileImported':
    case 'movieFileImported':
      return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'downloadFailed':
      return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'downloadIgnored':
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    case 'episodeFileDeleted':
    case 'movieFileDeleted':
      return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
    case 'renamed':
      return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
    default:
      return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
  }
}

function eventLabel(eventType: string) {
  switch (eventType) {
    case 'grabbed': return 'GRABBED';
    case 'downloadFolderImported':
    case 'episodeFileImported':
    case 'movieFileImported':
      return 'IMPORTED';
    case 'downloadFailed': return 'FAILED';
    case 'downloadIgnored': return 'IGNORED';
    case 'episodeFileDeleted':
    case 'movieFileDeleted':
      return 'DELETED';
    case 'renamed': return 'RENAMED';
    default: return eventType.toUpperCase();
  }
}

/**
 * Renders the History page UI including event and instance filters, a paginated list of history events, and a detail drawer for a selected event.
 *
 * The page supports server-side filtering by event type and instance, infinite "Load more" pagination, and displays event metadata and contextual information in a drawer when an item is selected.
 *
 * @returns The React element for the History page.
 */

export default function HistoryPage() {
  const [history, setHistory] = useState<(HistoryItem & { source?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [eventFilter, setEventFilter] = useState<EventFilterKey>('all');
  const [instanceFilter, setInstanceFilter] = useState<InstanceFilter>('all');
  const [selectedItem, setSelectedItem] = useState<(HistoryItem & { source?: string }) | null>(null);

  /**
   * Fetches a page of history events from the server and updates component state (history list, total count, and loading flags).
   *
   * Uses the current event and instance filters when querying the API. On network or parsing failure, displays a toast error and clears loading indicators.
   *
   * @param p - The 1-based page number to fetch
   * @param append - If `true`, append fetched records to the current history; otherwise replace the history
   */
  async function fetchHistory(p: number, append = false) {
    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const params = new URLSearchParams({ page: String(p), pageSize: '20' });
      if (eventFilter !== 'all') params.set('eventType', eventFilter);
      if (instanceFilter !== 'all') params.set('source', instanceFilter);
      const res = await fetch(`/api/activity/history?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (append) {
          setHistory((prev) => [...prev, ...(data.records || [])]);
        } else {
          setHistory(data.records || []);
        }
        setTotal(data.totalRecords || 0);
      }
    } catch {
      toast.error('Failed to load history');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    setPage(1);
    fetchHistory(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventFilter, instanceFilter]);

  /**
   * Advance to the next history page and append the newly fetched records to the existing list.
   */
  function handleLoadMore() {
    const next = page + 1;
    setPage(next);
    fetchHistory(next, true);
  }

  const activeFilterLabel = EVENT_FILTERS.find((f) => f.key === eventFilter)?.label || 'All Events';

  return (
    <div className="flex flex-col min-h-0">
      <PageHeader
        title="History"
        rightContent={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Filter className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {EVENT_FILTERS.map((opt) => (
                <DropdownMenuItem
                  key={opt.key}
                  onClick={() => setEventFilter(opt.key)}
                  className={eventFilter === opt.key ? 'bg-accent' : ''}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {/* Instance segmented control */}
      <div className="px-4 pb-3 pt-2">
        <div className="flex bg-muted/50 rounded-lg p-0.5 gap-0.5">
          {INSTANCE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setInstanceFilter(opt.key)}
              className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${
                instanceFilter === opt.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active filter indicator */}
      {eventFilter !== 'all' && (
        <div className="px-4 pb-2">
          <Badge variant="secondary" className="text-[10px]">
            {activeFilterLabel}
          </Badge>
        </div>
      )}

      {/* History list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm">No history events</p>
          </div>
        ) : (
          <div className="space-y-1">
            {history.map((item, i) => (
              <button
                key={`${item.source}-${item.id}-${i}`}
                onClick={() => setSelectedItem(item)}
                className="w-full text-left flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/50 active:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  {/* Status label */}
                  <Badge
                    variant="secondary"
                    className={`text-[9px] px-1.5 py-0 font-semibold ${eventColor(item.eventType)}`}
                  >
                    {eventLabel(item.eventType)}
                  </Badge>

                  {/* Filename - allow wrapping */}
                  <p className="text-sm leading-snug break-words">
                    {item.sourceTitle}
                  </p>

                  {/* Metadata row */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {item.quality?.quality?.name && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                        {item.quality.quality.name}
                      </Badge>
                    )}
                    {item.data?.droppedPath && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                        {item.data.indexer || item.data.downloadClient || ''}
                      </Badge>
                    )}
                    {!item.data?.droppedPath && item.data?.indexer && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                        {item.data.indexer}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                      {item.source}
                    </Badge>
                  </div>
                </div>

                {/* Time ago */}
                <span className="text-[10px] text-muted-foreground shrink-0 mt-1 tabular-nums">
                  {formatDistanceToNow(new Date(item.date), { addSuffix: true })}
                </span>
              </button>
            ))}

            {/* Load more */}
            {history.length < total && (
              <Button
                variant="ghost"
                className="w-full mt-2"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Load more
              </Button>
            )}
          </div>
        )}
      </div>

      {/* History item detail drawer */}
      <Drawer open={!!selectedItem} onOpenChange={(open) => { if (!open) setSelectedItem(null); }}>
        <DrawerContent>
          {selectedItem && (
            <>
              <DrawerHeader className="text-left">
                <Badge
                  variant="secondary"
                  className={`w-fit text-[10px] px-2 py-0.5 font-semibold ${eventColor(selectedItem.eventType)}`}
                >
                  {eventLabel(selectedItem.eventType)}
                </Badge>
                <DrawerTitle className="text-sm break-all leading-snug mt-1">
                  {selectedItem.sourceTitle}
                </DrawerTitle>
                <p className="text-xs text-muted-foreground">
                  {selectedItem.quality?.quality?.name}
                  {selectedItem.data?.size && ` · ${formatBytes(Number(selectedItem.data.size))}`}
                </p>
              </DrawerHeader>

              <div className="px-4 space-y-4 pb-6">
                {/* Tags row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">
                    {selectedItem.source?.toUpperCase()}
                  </Badge>
                  {selectedItem.data?.indexer && (
                    <Badge variant="outline" className="text-[10px]">
                      {selectedItem.data.indexer}
                    </Badge>
                  )}
                  {selectedItem.data?.releaseGroup && (
                    <Badge variant="outline" className="text-[10px]">
                      {selectedItem.data.releaseGroup}
                    </Badge>
                  )}
                </div>

                {/* Series / Movie info */}
                {selectedItem.series && (
                  <div className="rounded-lg bg-muted/30 p-3">
                    <p className="text-sm font-medium">{selectedItem.series.title}</p>
                    {selectedItem.episode && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        S{String(selectedItem.episode.seasonNumber).padStart(2, '0')}E{String(selectedItem.episode.episodeNumber).padStart(2, '0')} - {selectedItem.episode.title}
                      </p>
                    )}
                  </div>
                )}
                {selectedItem.movie && (
                  <div className="rounded-lg bg-muted/30 p-3">
                    <p className="text-sm font-medium">{selectedItem.movie.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{selectedItem.movie.year}</p>
                  </div>
                )}

                {/* Information section */}
                <div>
                  <h3 className="font-semibold text-sm mb-2">Information</h3>
                  <div className="space-y-0 rounded-lg border divide-y">
                    <InfoRow label="Event" value={eventLabel(selectedItem.eventType)} />
                    <InfoRow label="Quality" value={selectedItem.quality?.quality?.name || '-'} />
                    {selectedItem.data?.indexer && (
                      <InfoRow label="Indexer" value={selectedItem.data.indexer} />
                    )}
                    {selectedItem.data?.downloadClient && (
                      <InfoRow label="Client" value={selectedItem.data.downloadClient} />
                    )}
                    {selectedItem.data?.protocol && (
                      <InfoRow label="Protocol" value={selectedItem.data.protocol} />
                    )}
                    {selectedItem.data?.releaseGroup && (
                      <InfoRow label="Release Group" value={selectedItem.data.releaseGroup} />
                    )}
                    {selectedItem.data?.nzbInfoUrl && (
                      <InfoRow label="NZB Info" value={selectedItem.data.nzbInfoUrl} />
                    )}
                    {selectedItem.data?.size && (
                      <InfoRow label="Size" value={formatBytes(Number(selectedItem.data.size))} />
                    )}
                    <InfoRow
                      label="Date"
                      value={formatDistanceToNow(new Date(selectedItem.date), { addSuffix: true })}
                    />
                    <InfoRow label="Source" value={selectedItem.source || '-'} />
                  </div>
                </div>
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

// --- Helpers ---

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-right max-w-[60%] break-words">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}