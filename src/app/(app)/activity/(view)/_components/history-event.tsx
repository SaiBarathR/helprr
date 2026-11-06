'use client';

import { useState, type JSX } from 'react';
import Link from '@/components/ui/app-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { AlertTriangle, Copy, ExternalLink, Info, ChevronRight, Loader2, RotateCw, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { HistoryItem } from '@/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppRouter } from '@/components/layout/navigation-provider';
import { useCan } from '@/components/permission-provider';
import { arrInteractiveSearchHref } from '@/lib/arr-edit-href';
import { arrMutationFetch } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';

// A history event's row and detail sheet, shared by the History page and the
// Needs import tab's Recent failures, so a failure looks and opens the same in both.

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

export type HistoryRecord = HistoryItem & { source?: string };

function getHistoryMediaHref(item: HistoryRecord): string | null {
  const q = item.instanceId ? `?instance=${item.instanceId}` : '';
  const seriesId = item.seriesId ?? item.series?.id;
  if (seriesId) {
    const episode = item.episode;
    return episode
      ? `/series/${seriesId}/season/${episode.seasonNumber}/episode/${episode.id}${q}`
      : `/series/${seriesId}${q}`;
  }
  const movieId = item.movieId ?? item.movie?.id;
  if (movieId) return `/movies/${movieId}${q}`;
  const albumId = item.albumId ?? item.album?.id;
  if (albumId) return `/music/album/${albumId}${q}`;
  return null;
}

type FailedEventSearch = {
  path: string;
  body: { name: string } & Record<string, unknown>;
  interactiveHref: string | null;
};

// Search again sends the same command the push Retry action does (one episode,
// movie or album) to the event's own instance.
function getFailedEventSearch(item: HistoryRecord): FailedEventSearch | null {
  if (item.source === 'sonarr') {
    const episodeId = item.episodeId ?? item.episode?.id;
    if (!episodeId) return null;
    const seriesId = item.seriesId ?? item.series?.id;
    const ep = item.episode;
    // Titled as the episode page titles its interactive search.
    const title = ep
      ? `${item.series?.title ?? item.sourceTitle} - S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.title || 'TBA'}`
      : item.sourceTitle;
    return {
      path: '/api/sonarr/command',
      body: { name: 'EpisodeSearch', episodeIds: [episodeId] },
      interactiveHref: seriesId && ep
        ? arrInteractiveSearchHref({ kind: 'episode', seriesId, seasonNumber: ep.seasonNumber, episodeId }, title, item.instanceId)
        : null,
    };
  }
  if (item.source === 'radarr') {
    const movieId = item.movieId ?? item.movie?.id;
    if (!movieId) return null;
    return {
      path: '/api/radarr/command',
      body: { name: 'MoviesSearch', movieIds: [movieId] },
      interactiveHref: arrInteractiveSearchHref({ kind: 'movie', movieId }, item.movie?.title ?? item.sourceTitle, item.instanceId),
    };
  }
  if (item.source === 'lidarr') {
    const albumId = item.albumId ?? item.album?.id;
    if (!albumId) return null;
    return {
      path: '/api/lidarr/command',
      body: { name: 'AlbumSearch', albumIds: [albumId] },
      interactiveHref: arrInteractiveSearchHref({ kind: 'album', albumId }, item.album?.title ?? item.sourceTitle, item.instanceId),
    };
  }
  return null;
}

function getHistoryMediaLabel(item: HistoryRecord): string {
  if (item.seriesId ?? item.series?.id) return item.episode ? 'Open episode' : 'Open series';
  if (item.movieId ?? item.movie?.id) return 'Open movie';
  return 'Open album';
}

async function copyHistoryText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Copy failed');
  }
}

/** One history event: its badge, release name and metadata; tap opens its detail sheet. */
export function HistoryEventRow({ item, onSelect }: { item: HistoryRecord; onSelect: () => void }) {
  const mediaHref = getHistoryMediaHref(item);
  return (
    <QuickContextMenu
      label={`Actions for ${item.sourceTitle}`}
      groups={[
        {
          id: 'navigation',
          actions: [
            {
              id: 'view-details',
              label: 'View details',
              icon: <Info className="h-4 w-4" />,
              onSelect,
            },
            ...(mediaHref
              ? [{
                  id: 'open-media',
                  label: 'Open related media',
                  icon: <ExternalLink className="h-4 w-4" />,
                  href: mediaHref,
                }]
              : []),
          ],
        },
        {
          id: 'copy',
          actions: [{
            id: 'copy-source-title',
            label: 'Copy source title',
            icon: <Copy className="h-4 w-4" />,
            onSelect: () => void copyHistoryText(item.sourceTitle, 'Source title'),
          }],
        },
      ]}
    >
    <button
      onClick={onSelect}
      className="-mx-2 w-[calc(100%+1rem)] text-left flex items-start gap-3 py-2.5 px-2 rounded-lg hover:bg-muted/50 active:bg-muted/50 transition-colors md:-mx-3 md:w-[calc(100%+1.5rem)] md:px-3"
    >
      <div className="flex-1 min-w-0 space-y-1">
        {/* Status label */}
        <Badge
          variant="secondary"
          className={`text-[9px] px-1.5 py-0 font-semibold ${eventColor(item.eventType)}`}
        >
          {eventLabel(item.eventType)}
        </Badge>

        {/* Filename: up to two lines (the drawer has the full name) */}
        <p className="text-sm leading-snug break-words line-clamp-2">
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
    </QuickContextMenu>
  );
}

/** The detail sheet for a history event (Basic summary, or every field under Detailed). */
export function HistoryEventDrawer({ item, onClose }: { item: HistoryRecord | null; onClose: () => void }) {
  const [mode, setMode] = useState<DrawerMode>('basic');
  // Held here, not in the panel, so a search still running stays pending when the
  // panel remounts (switching to Detailed and back, or reopening the event).
  const [searchingKey, setSearchingKey] = useState<string | null>(null);

  return (
    <Drawer
      open={!!item}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setMode('basic');
        }
      }}
    >
      <DrawerContent>
        {item && (
          <>
            <DrawerHeader className="text-left">
              <Badge
                variant="secondary"
                className={`w-fit text-[10px] px-2 py-0.5 font-semibold ${eventColor(item.eventType)}`}
              >
                {eventLabel(item.eventType)}
              </Badge>
              <DrawerTitle className="text-sm break-all leading-snug mt-1">
                {item.sourceTitle}
              </DrawerTitle>
              <p className="text-xs text-muted-foreground">
                {mode === 'basic' ? (
                  (() => {
                    const parts: string[] = [];
                    const qualityName = item.quality?.quality?.name;
                    if (qualityName) parts.push(qualityName);
                    if (item.data?.size) parts.push(formatBytes(Number(item.data.size)));
                    return parts.join(' · ');
                  })()
                ) : (
                  <>
                    {(item.source || 'unknown').toUpperCase()} ·{' '}
                    {formatDistanceToNow(new Date(item.date), { addSuffix: true })}
                  </>
                )}
              </p>
            </DrawerHeader>

            <div className="px-4 pb-3">
              {/* Radix Tabs: segmented look + roving focus / arrow-key nav. */}
              <Tabs
                value={mode}
                onValueChange={(v) => setMode(v as 'basic' | 'detailed')}
                className="gap-0"
              >
                <TabsList className="flex w-full h-auto bg-muted/50 p-0.5 gap-0.5" aria-label="Detail level">
                  <TabsTrigger value="basic" className="flex-1 text-xs font-medium py-1.5 px-2 data-[state=active]:shadow-sm">
                    Basic
                  </TabsTrigger>
                  <TabsTrigger value="detailed" className="flex-1 text-xs font-medium py-1.5 px-2 data-[state=active]:shadow-sm">
                    Detailed
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {mode === 'basic' ? (
              <div className="px-4 space-y-4 pb-6 overflow-y-auto flex-1 min-h-0">
                {/* Download failures only: Lidarr's albumImportIncomplete has no message, and its
                    download is still waiting for a manual import, so searching again is wrong for it. */}
                {(item.eventType === 'downloadFailed' || item.eventType === 'failed') && (() => {
                  const key = `${item.source}-${item.instanceId}-${item.id}`;
                  return (
                    <FailedEventPanel
                      item={item}
                      searching={searchingKey === key}
                      onSearchingChange={(on) => setSearchingKey((current) => (on ? key : current === key ? null : current))}
                    />
                  );
                })()}

                {/* Tags row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">
                    {item.source?.toUpperCase()}
                  </Badge>
                  {item.data?.indexer && (
                    <Badge variant="outline" className="text-[10px]">
                      {item.data.indexer}
                    </Badge>
                  )}
                  {item.data?.releaseGroup && (
                    <Badge variant="outline" className="text-[10px]">
                      {item.data.releaseGroup}
                    </Badge>
                  )}
                </div>

                {/* Series / Movie info */}
                {item.series && (() => {
                  const ep = item.episode;
                  const seriesId = item.seriesId || item.series.id;
                  const q = item.instanceId ? `?instance=${item.instanceId}` : '';
                  const href = seriesId && ep
                    ? `/series/${seriesId}/season/${ep.seasonNumber}/episode/${ep.id}${q}`
                    : seriesId
                      ? `/series/${seriesId}${q}`
                      : null;
                  const content = (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{item.series.title}</p>
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
                {item.movie && (() => {
                  const movieId = item.movieId || item.movie.id;
                  const q = item.instanceId ? `?instance=${item.instanceId}` : '';
                  const href = movieId ? `/movies/${movieId}${q}` : null;
                  const content = (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{item.movie.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.movie.year}</p>
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
                {item.album && (() => {
                  const albumId = item.albumId || item.album.id;
                  const q = item.instanceId ? `?instance=${item.instanceId}` : '';
                  const href = albumId ? `/music/album/${albumId}${q}` : null;
                  const content = (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{item.album.title}</p>
                        {item.artist?.artistName && (
                          <p className="text-xs text-muted-foreground mt-0.5">{item.artist.artistName}</p>
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
                    <InfoRow label="Event" value={eventLabel(item.eventType)} />
                    <InfoRow label="Quality" value={item.quality?.quality?.name || '-'} />
                    {item.data?.indexer && (
                      <InfoRow label="Indexer" value={item.data.indexer} />
                    )}
                    {item.data?.downloadClient && (
                      <InfoRow label="Client" value={item.data.downloadClient} />
                    )}
                    {item.data?.protocol && (
                      <InfoRow label="Protocol" value={item.data.protocol} />
                    )}
                    {item.data?.releaseGroup && (
                      <InfoRow label="Release Group" value={item.data.releaseGroup} />
                    )}
                    {item.data?.nzbInfoUrl && (
                      <InfoRow label="NZB Info" value={item.data.nzbInfoUrl} />
                    )}
                    {item.data?.size && (
                      <InfoRow label="Size" value={formatBytes(Number(item.data.size))} />
                    )}
                    <InfoRow
                      label="Date"
                      value={formatDistanceToNow(new Date(item.date), { addSuffix: true })}
                    />
                    <InfoRow label="Source" value={item.source || '-'} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-4 pb-6 overflow-y-auto flex-1 min-h-0">
                <div className="space-y-2">
                  {Object.entries(item).map(([key, value]) => (
                    <RecursiveField key={key} name={key} value={value} depth={0} ancestors={[]} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/** A failed event's reason, and the ways to recover: search again, pick a release, or open the media. */
function FailedEventPanel({
  item,
  searching,
  onSearchingChange,
}: {
  item: HistoryRecord;
  searching: boolean;
  onSearchingChange: (searching: boolean) => void;
}) {
  const canSearch = useCan('activity.manage');
  const router = useAppRouter();
  const reason = item.data?.message;
  const search = canSearch ? getFailedEventSearch(item) : null;
  const interactiveHref = search?.interactiveHref;
  const mediaHref = getHistoryMediaHref(item);

  async function searchAgain() {
    if (!search) return;
    onSearchingChange(true);
    try {
      const res = await arrMutationFetch(item.instanceId, search.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(search.body),
      });
      if (!res.ok) throw new Error(`${search.body.name} → ${res.status}`);
      toast.success('Search started');
    } catch (e) { handleAuthError(e); toast.error('Search failed'); }
    finally { onSearchingChange(false); }
  }

  return (
    <div className="space-y-3">
      {reason && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            Why it failed
          </p>
          <p className="mt-1 text-sm break-words">{reason}</p>
        </div>
      )}
      {(search || mediaHref) && (
        <div className="flex flex-wrap gap-2">
          {search && (
            <Button onClick={() => void searchAgain()} disabled={searching} aria-busy={searching}>
              {searching ? <Loader2 className="animate-spin" /> : <RotateCw />}
              Search again
            </Button>
          )}
          {interactiveHref && (
            <Button variant="outline" onClick={() => router.push(interactiveHref)}>
              <Search />
              Interactive search
            </Button>
          )}
          {mediaHref && (
            <Button variant="outline" asChild>
              <Link href={mediaHref}>
                <ExternalLink />
                {getHistoryMediaLabel(item)}
              </Link>
            </Button>
          )}
        </div>
      )}
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
