'use client';

import { useEffect, useMemo, useState, type JSX } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
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
import { Filter, Loader2, ExternalLink, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { HistoryItem } from '@/types';
import { InstanceFilter, type InstanceOption } from '@/components/instance-filter';

// --- Event type config ---

type EventFilterKey = 'all' | 'grabbed' | 'imported' | 'failed' | 'deleted' | 'renamed' | 'ignored';

interface EventFilterOption {
  key: EventFilterKey;
  label: string;
}

const EVENT_FILTERS: EventFilterOption[] = [
  { key: 'all', label: 'All Events' },
  { key: 'grabbed', label: 'Grabbed' },
  { key: 'imported', label: 'Imported' },
  { key: 'failed', label: 'Failed' },
  { key: 'deleted', label: 'Deleted' },
  { key: 'renamed', label: 'Renamed' },
  { key: 'ignored', label: 'Ignored' },
];

type DrawerMode = 'basic' | 'detailed';

// --- Event styling ---

function eventColor(eventType: string) {
  switch (eventType) {
    case 'grabbed':
      return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    case 'downloadFolderImported':
    case 'episodeFileImported':
    case 'movieFileImported':
    case 'trackFileImported':
    case 'imported':
      return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'downloadFailed':
    case 'albumImportIncomplete':
    case 'failed':
      return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'downloadIgnored':
    case 'ignored':
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    case 'episodeFileDeleted':
    case 'movieFileDeleted':
    case 'trackFileDeleted':
    case 'deleted':
      return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
    case 'renamed':
    case 'episodeFileRenamed':
    case 'movieFileRenamed':
    case 'trackFileRenamed':
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
    case 'trackFileImported':
    case 'imported':
      return 'IMPORTED';
    case 'downloadFailed':
    case 'albumImportIncomplete':
    case 'failed':
      return 'FAILED';
    case 'downloadIgnored':
    case 'ignored':
      return 'IGNORED';
    case 'episodeFileDeleted':
    case 'movieFileDeleted':
    case 'trackFileDeleted':
    case 'deleted':
      return 'DELETED';
    case 'renamed':
    case 'episodeFileRenamed':
    case 'movieFileRenamed':
    case 'trackFileRenamed':
      return 'RENAMED';
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

type HistoryRecord = HistoryItem & { source?: string };
type HistoryResponse = { records?: HistoryRecord[]; totalRecords?: number };

function buildHistoryUrl(p: number, eventFilter: EventFilterKey, instanceFilter: string) {
  const params = new URLSearchParams({ page: String(p), pageSize: '20' });
  if (eventFilter !== 'all') params.set('eventType', eventFilter);
  if (instanceFilter !== 'all') params.set('instanceId', instanceFilter);
  return `/api/activity/history?${params}`;
}

export default function HistoryPage() {
  const [eventFilter, setEventFilter] = useState<EventFilterKey>('all');
  const [instanceFilter, setInstanceFilter] = useState<string>('all');
  const [selectedItem, setSelectedItem] = useState<HistoryRecord | null>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('basic');

  // Infinite list: the filters live in the query key, so changing them swaps the
  // key and refetches from page 1 (no manual reset). "Load more" → fetchNextPage,
  // gated on the raw totalRecords. Mirrors the notifications / activity WantedTab
  // pattern so the whole list lives in the query cache, not a side state array.
  const {
    data,
    isLoading: loading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['activity', 'history', { eventFilter, instanceFilter }],
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<HistoryResponse>(buildHistoryUrl(pageParam, eventFilter, instanceFilter))({ signal }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, pg) => sum + (pg.records?.length ?? 0), 0);
      return loaded < (lastPage.totalRecords ?? 0) ? allPages.length + 1 : undefined;
    },
  });

  // The old code surfaced the initial fetch failure as a toast; preserve that.
  // (A failed "Load more" just doesn't append, matching the other infinite lists.)
  useEffect(() => {
    if (isError) toast.error('Failed to load history');
  }, [isError]);

  const history = useMemo(
    () => data?.pages.flatMap((pg) => pg.records ?? []) ?? [],
    [data],
  );

  // Load arr instances for the per-instance filter, independent of the (possibly
  // filtered) history so the options never collapse to the current selection.
  const { data: instanceOptions = [] } = useQuery({
    // Distinct from queryKeys.instances() (['instances','all'] → /api/services); this
    // is the /api/instances connection list for the filter. Shares with the activity
    // page's same-key query, and can't prefix-collide with the services key.
    queryKey: ['arr-instances'],
    queryFn: jsonFetcher<Array<{ id: string; label: string }>>('/api/instances'),
    select: (conns): InstanceOption[] =>
      Array.isArray(conns) ? conns.map((c) => ({ id: c.id, label: c.label })) : [],
    staleTime: 5 * 60_000,
  });

  // Drop a stale instance selection if that instance no longer exists. Correcting
  // invalid local state against freshly-loaded options is a legitimate effect; the
  // set-state-in-effect rule (now reachable since the component became analyzable
  // when handleLoadMore was removed) is suppressed here.
  useEffect(() => {
    if (instanceFilter !== 'all' && !instanceOptions.some((i) => i.id === instanceFilter)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInstanceFilter('all');
    }
  }, [instanceOptions, instanceFilter]);

  const activeFilterLabel = EVENT_FILTERS.find((f) => f.key === eventFilter)?.label || 'All Events';

  return (
    <div className="flex flex-col min-h-0 animate-content-in">
      <PageHeader
        title="History"
        rightContent={
          <div className="flex items-center gap-2">
            <InstanceFilter instances={instanceOptions} value={instanceFilter} onChange={setInstanceFilter} />
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
          </div>
        }
      />

      {/* Active filter indicator */}
      {eventFilter !== 'all' && (
        <div className="pb-2">
          <Badge variant="secondary" className="text-[10px]">
            {activeFilterLabel}
          </Badge>
        </div>
      )}

      {/* History list */}
      <div className="flex-1 overflow-y-auto pb-4">
        {loading ? (
          <PageSpinner />
        ) : history.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm">No history events</p>
          </div>
        ) : (
          <div className="space-y-1 animate-list-in">
            {history.map((item, i) => (
              <button
                key={`${item.source}-${item.id}-${i}`}
                onClick={() => {
                  setDrawerMode('basic');
                  setSelectedItem(item);
                }}
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
            {hasNextPage && (
              <Button
                variant="ghost"
                className="w-full mt-2"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Load more
              </Button>
            )}
          </div>
        )}
      </div>

      {/* History item detail drawer */}
      <Drawer
        open={!!selectedItem}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedItem(null);
            setDrawerMode('basic');
          }
        }}
      >
        <DrawerContent className="max-h-[85vh]">
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
                  {drawerMode === 'basic' ? (
                    (() => {
                      const parts: string[] = [];
                      const qualityName = selectedItem.quality?.quality?.name;
                      if (qualityName) parts.push(qualityName);
                      if (selectedItem.data?.size) parts.push(formatBytes(Number(selectedItem.data.size)));
                      return parts.join(' · ');
                    })()
                  ) : (
                    <>
                      {(selectedItem.source || 'unknown').toUpperCase()} ·{' '}
                      {formatDistanceToNow(new Date(selectedItem.date), { addSuffix: true })}
                    </>
                  )}
                </p>
              </DrawerHeader>

              <div className="px-4 pb-3">
                <div className="flex bg-muted/50 rounded-lg p-0.5 gap-0.5">
                  <button
                    onClick={() => setDrawerMode('basic')}
                    className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${
                      drawerMode === 'basic'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Basic
                  </button>
                  <button
                    onClick={() => setDrawerMode('detailed')}
                    className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${
                      drawerMode === 'detailed'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Detailed
                  </button>
                </div>
              </div>

              {drawerMode === 'basic' ? (
                <div className="px-4 space-y-4 pb-6 overflow-y-auto flex-1 min-h-0">
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
                  {selectedItem.series && (() => {
                    const ep = selectedItem.episode;
                    const seriesId = selectedItem.seriesId || selectedItem.series.id;
                    const q = selectedItem.instanceId ? `?instance=${selectedItem.instanceId}` : '';
                    const href = seriesId && ep
                      ? `/series/${seriesId}/season/${ep.seasonNumber}/episode/${ep.id}${q}`
                      : seriesId
                        ? `/series/${seriesId}${q}`
                        : null;
                    const content = (
                      <>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{selectedItem.series.title}</p>
                          {ep && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              S{String(ep.seasonNumber).padStart(2, '0')}
                              E{String(ep.episodeNumber).padStart(2, '0')} - {ep.title}
                            </p>
                          )}
                        </div>
                        {href && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                      </>
                    );
                    return href ? (
                      <Link href={href} className="flex items-center gap-2 rounded-lg bg-muted/30 p-3 hover:bg-muted/50 transition-colors">
                        {content}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg bg-muted/30 p-3">{content}</div>
                    );
                  })()}
                  {selectedItem.movie && (() => {
                    const movieId = selectedItem.movieId || selectedItem.movie.id;
                    const q = selectedItem.instanceId ? `?instance=${selectedItem.instanceId}` : '';
                    const href = movieId ? `/movies/${movieId}${q}` : null;
                    const content = (
                      <>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{selectedItem.movie.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{selectedItem.movie.year}</p>
                        </div>
                        {href && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                      </>
                    );
                    return href ? (
                      <Link href={href} className="flex items-center gap-2 rounded-lg bg-muted/30 p-3 hover:bg-muted/50 transition-colors">
                        {content}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg bg-muted/30 p-3">{content}</div>
                    );
                  })()}
                  {selectedItem.album && (() => {
                    const albumId = selectedItem.albumId || selectedItem.album.id;
                    const q = selectedItem.instanceId ? `?instance=${selectedItem.instanceId}` : '';
                    const href = albumId ? `/music/album/${albumId}${q}` : null;
                    const content = (
                      <>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{selectedItem.album.title}</p>
                          {selectedItem.artist?.artistName && (
                            <p className="text-xs text-muted-foreground mt-0.5">{selectedItem.artist.artistName}</p>
                          )}
                        </div>
                        {href && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                      </>
                    );
                    return href ? (
                      <Link href={href} className="flex items-center gap-2 rounded-lg bg-muted/30 p-3 hover:bg-muted/50 transition-colors">
                        {content}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg bg-muted/30 p-3">{content}</div>
                    );
                  })()}

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
              ) : (
                <div className="px-4 pb-6 overflow-y-auto flex-1 min-h-0">
                  <div className="space-y-2">
                    {Object.entries(selectedItem).map(([key, value]) => (
                      <RecursiveField key={key} name={key} value={value} depth={0} ancestors={[]} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

// --- Helpers ---

function RecursiveField({
  name,
  value,
  depth,
  ancestors,
}: {
  name: string;
  value: unknown;
  depth: number;
  ancestors: object[];
}): JSX.Element | null {

  const valueType = typeof value;
  const isObject = valueType === 'object' && value !== null;
  const hasName = name.trim().length > 0;
  const displayName = hasName ? name : 'Item';

  if (!isObject) {
    return (
      <div className="rounded-md border bg-muted/20 px-2 py-1.5">
        <div className={`flex items-start gap-2 ${hasName ? '' : 'justify-end'}`}>
          {hasName && (
            <span className="text-[11px] font-mono text-muted-foreground min-w-[110px] break-all">{name}</span>
          )}
          <div className={`text-[11px] break-all flex-1 ${hasName ? 'text-right' : 'text-left'}`}>
            <PrimitiveValue value={value} />
          </div>
        </div>
      </div>
    );
  }

  const obj = value as object;
  if (ancestors.includes(obj)) {
    return (
      <div className="rounded-md border bg-muted/20 px-2 py-1.5">
        <div className={`flex items-start gap-2 ${hasName ? '' : 'justify-end'}`}>
          {hasName && (
            <span className="text-[11px] font-mono text-muted-foreground min-w-[110px] break-all">{name}</span>
          )}
          <span className={`text-[11px] text-orange-400 break-all flex-1 ${hasName ? 'text-right' : 'text-left'}`}>
            [Circular]
          </span>
        </div>
      </div>
    );
  }

  const nextAncestors = [...ancestors, obj];
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? (value as unknown[]).map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  const openByDefault = depth < 1;

  return (
    <details open={openByDefault} className="rounded-md border bg-muted/20">
      <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-mono text-muted-foreground break-all">
        {displayName}
      </summary>
      <div className="border-t px-2 py-2 space-y-2">
        {entries.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic">
            {Array.isArray(value) ? '[]' : '{}'}
          </div>
        ) : (
          entries.map(([childKey, childValue]) => (
            <RecursiveField
              key={`${name}.${childKey}`}
              name={Array.isArray(value) ? '' : childKey}
              value={childValue}
              depth={depth + 1}
              ancestors={nextAncestors}
            />
          ))
        )}
      </div>
    </details>
  );
}

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

function PrimitiveValue({ value }: { value: unknown }) {
  if (value === null) return <span className="italic text-muted-foreground">null</span>;
  if (value === undefined) return <span className="italic text-muted-foreground">undefined</span>;
  if (typeof value === 'boolean') return <span>{value ? 'true' : 'false'}</span>;
  if (typeof value === 'number') return <span>{Number.isFinite(value) ? String(value) : 'NaN'}</span>;
  if (typeof value === 'bigint') return <span>{value.toString()}</span>;
  if (typeof value === 'string') {
    if (!value) return <span className="italic text-muted-foreground">{'""'}</span>;
    if (/^https?:\/\//i.test(value)) {
      return (
        <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
          {value}
        </a>
      );
    }
    return <span>{value}</span>;
  }
  return <span>{String(value)}</span>;
}
