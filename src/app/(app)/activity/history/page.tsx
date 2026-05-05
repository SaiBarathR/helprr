'use client';

import { useEffect, useState, type JSX } from 'react';
import Link from 'next/link';
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

// --- Instance filter ---

type InstanceFilter = 'all' | 'sonarr' | 'radarr';
type DrawerMode = 'basic' | 'detailed';

const INSTANCE_OPTIONS: { key: InstanceFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sonarr', label: 'Sonarr' },
  { key: 'radarr', label: 'Radarr' },
];

// --- Event styling ---

function eventPillStyle(eventType: string): React.CSSProperties {
  const base = { borderRadius: '3px', letterSpacing: '0.22em', border: '1px solid' };
  switch (eventType) {
    case 'grabbed':
      return { ...base, background: 'var(--amber-soft)', borderColor: 'oklch(0.80 0.15 70 / 0.4)', color: 'var(--amber)' };
    case 'downloadFolderImported':
    case 'episodeFileImported':
    case 'movieFileImported':
    case 'imported':
      return { ...base, background: 'oklch(0.78 0.13 162 / 0.16)', borderColor: 'oklch(0.78 0.13 162 / 0.4)', color: 'oklch(0.78 0.13 162)' };
    case 'downloadFailed':
    case 'failed':
      return { ...base, background: 'oklch(0.66 0.20 25 / 0.16)', borderColor: 'oklch(0.66 0.20 25 / 0.4)', color: 'oklch(0.78 0.18 25)' };
    case 'downloadIgnored':
    case 'ignored':
      return { ...base, background: 'oklch(0.78 0.16 78 / 0.14)', borderColor: 'oklch(0.78 0.16 78 / 0.4)', color: 'oklch(0.80 0.16 78)' };
    case 'episodeFileDeleted':
    case 'movieFileDeleted':
    case 'deleted':
      return { ...base, background: 'oklch(0.55 0.18 28 / 0.14)', borderColor: 'oklch(0.55 0.18 28 / 0.4)', color: 'oklch(0.78 0.18 28)' };
    case 'renamed':
    case 'episodeFileRenamed':
    case 'movieFileRenamed':
      return { ...base, background: 'oklch(0.72 0.13 220 / 0.14)', borderColor: 'oklch(0.72 0.13 220 / 0.4)', color: 'oklch(0.80 0.13 220)' };
    default:
      return { ...base, background: 'var(--muted)', borderColor: 'var(--hairline)', color: 'var(--muted-foreground)' };
  }
}

function eventLabel(eventType: string) {
  switch (eventType) {
    case 'grabbed': return 'GRABBED';
    case 'downloadFolderImported':
    case 'episodeFileImported':
    case 'movieFileImported':
    case 'imported':
      return 'IMPORTED';
    case 'downloadFailed':
    case 'failed':
      return 'FAILED';
    case 'downloadIgnored':
    case 'ignored':
      return 'IGNORED';
    case 'episodeFileDeleted':
    case 'movieFileDeleted':
    case 'deleted':
      return 'DELETED';
    case 'renamed':
    case 'episodeFileRenamed':
    case 'movieFileRenamed':
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

export default function HistoryPage() {
  const [history, setHistory] = useState<(HistoryItem & { source?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [eventFilter, setEventFilter] = useState<EventFilterKey>('all');
  const [instanceFilter, setInstanceFilter] = useState<InstanceFilter>('all');
  const [selectedItem, setSelectedItem] = useState<(HistoryItem & { source?: string }) | null>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('basic');

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
    <div className="flex flex-col min-h-0 animate-content-in">
      <PageHeader
        title="Booth Log"
        subtitle="Activity History"
        rightContent={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="press-feedback h-9 w-9 inline-flex items-center justify-center hover:text-[color:var(--amber)] transition-colors"
                aria-label="Filter"
              >
                <Filter className="h-4 w-4" />
              </button>
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

      {/* Instance tab strip */}
      <div className="py-3">
        <div className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1">
          {INSTANCE_OPTIONS.map((opt) => {
            const active = instanceFilter === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setInstanceFilter(opt.key)}
                className={`relative px-3 py-2 inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
                  active ? 'text-foreground' : 'text-muted-foreground/70 hover:text-foreground'
                }`}
              >
                <span className="font-display text-[14px]" style={{ letterSpacing: '-0.01em' }}>
                  {opt.label}
                </span>
                <span
                  aria-hidden
                  className={`absolute left-2 right-2 -bottom-px h-px transition-all ${
                    active ? 'bg-[color:var(--amber)] opacity-100' : 'bg-foreground/20 opacity-0'
                  }`}
                />
              </button>
            );
          })}
        </div>
        <div className="hairline" aria-hidden />
      </div>

      {eventFilter !== 'all' && (
        <div className="pb-3">
          <span
            className="tracked-caps text-[9px] px-1.5 py-0.5 inline-block"
            style={{
              borderRadius: '3px',
              letterSpacing: '0.22em',
              background: 'var(--amber-soft)',
              border: '1px solid oklch(0.80 0.15 70 / 0.4)',
              color: 'var(--amber)',
            }}
          >
            Filter · {activeFilterLabel}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-4">
        {loading ? (
          <PageSpinner />
        ) : history.length === 0 ? (
          <div
            className="border border-[color:var(--hairline)] bg-card/40 p-10 text-center space-y-3"
            style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
          >
            <p className="tracked-caps text-[10px] text-muted-foreground">No history</p>
            <p className="font-display text-[18px]">Booth log empty.</p>
          </div>
        ) : (
          <div className="space-y-2 animate-list-in">
            <div className="border border-[color:var(--hairline)] bg-card/40 overflow-hidden" style={{ borderRadius: 'calc(var(--radius) - 1px)' }}>
              {history.map((item, i) => (
                <button
                  key={`${item.source}-${item.id}-${i}`}
                  onClick={() => {
                    setDrawerMode('basic');
                    setSelectedItem(item);
                  }}
                  className="group w-full text-left flex items-start gap-3 py-3 px-3.5 border-b border-[color:var(--hairline)] last:border-b-0 hover:bg-[color:var(--amber-soft)]/30 transition-colors"
                >
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <span
                      className="tracked-caps text-[8.5px] px-1.5 py-0.5"
                      style={eventPillStyle(item.eventType)}
                    >
                      {eventLabel(item.eventType)}
                    </span>

                    <p className="font-mono tabular text-[12px] leading-snug break-words text-foreground/90">
                      {item.sourceTitle}
                    </p>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {item.quality?.quality?.name && (
                        <span
                          className="tracked-caps text-[8.5px] px-1.5 py-0.5 bg-[color:var(--amber-soft)] text-[color:var(--amber)]"
                          style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
                        >
                          {item.quality.quality.name}
                        </span>
                      )}
                      {item.data?.droppedPath && (
                        <span
                          className="tracked-caps text-[8px] px-1.5 py-0.5 border border-[color:var(--hairline)] bg-card/50 text-muted-foreground"
                          style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
                        >
                          {item.data.indexer || item.data.downloadClient || ''}
                        </span>
                      )}
                      {!item.data?.droppedPath && item.data?.indexer && (
                        <span
                          className="tracked-caps text-[8px] px-1.5 py-0.5 border border-[color:var(--hairline)] bg-card/50 text-muted-foreground"
                          style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
                        >
                          {item.data.indexer}
                        </span>
                      )}
                      <span
                        className="tracked-caps text-[8px] px-1.5 py-0.5 border border-[color:var(--hairline)] bg-card/50 text-muted-foreground"
                        style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
                      >
                        {item.source}
                      </span>
                    </div>
                  </div>

                  <span className="font-mono tabular text-[10px] text-muted-foreground/80 shrink-0 mt-1">
                    {formatDistanceToNow(new Date(item.date), { addSuffix: true })}
                  </span>
                </button>
              ))}
            </div>

            {history.length < total && (
              <Button
                variant="outline"
                className="w-full h-10 cta-sheen"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                <span className="tracked-caps text-[10px]">Load more</span>
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
              <DrawerHeader className="text-left space-y-1.5">
                <span
                  className="w-fit tracked-caps text-[9px] px-1.5 py-0.5"
                  style={eventPillStyle(selectedItem.eventType)}
                >
                  {eventLabel(selectedItem.eventType)}
                </span>
                <DrawerTitle className="font-mono tabular text-[12.5px] break-all leading-snug" style={{ letterSpacing: '0.005em' }}>
                  {selectedItem.sourceTitle}
                </DrawerTitle>
                <p className="font-mono tabular text-[10.5px] text-muted-foreground/85">
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
                <div className="flex items-center gap-1">
                  {(['basic', 'detailed'] as const).map((mode) => {
                    const active = drawerMode === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => setDrawerMode(mode)}
                        className={`relative flex-1 px-3 py-2 inline-flex items-center justify-center gap-2 transition-colors ${
                          active ? 'text-foreground' : 'text-muted-foreground/70 hover:text-foreground'
                        }`}
                      >
                        <span className="font-display text-[14px] capitalize" style={{ letterSpacing: '-0.01em' }}>
                          {mode}
                        </span>
                        <span
                          aria-hidden
                          className={`absolute left-2 right-2 -bottom-px h-px transition-all ${
                            active ? 'bg-[color:var(--amber)] opacity-100' : 'bg-foreground/20 opacity-0'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              {drawerMode === 'basic' ? (
                <div className="px-4 space-y-4 pb-6 overflow-y-auto">
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
                    const href = seriesId && ep
                      ? `/series/${seriesId}/season/${ep.seasonNumber}/episode/${ep.id}`
                      : seriesId
                        ? `/series/${seriesId}`
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
                    const href = movieId ? `/movies/${movieId}` : null;
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
                <div className="px-4 pb-6 overflow-y-auto">
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
