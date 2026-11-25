'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Copy, ExternalLink, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '@/lib/date-format';
import { formatBytes, formatDownloadProtocol } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { PageSpinner } from '@/components/ui/page-spinner';
import { QuickContextMenu, type ContextAction } from '@/components/ui/quick-context-menu';
import { MarkFailedButton, canMarkFailed } from '@/components/media/mark-failed-button';
import { useCan } from '@/components/permission-provider';
import type { HistoryItem } from '@/types';

// Radarr and Sonarr name the same events differently (movieFile* / episodeFile*).
export function eventTypeLabel(eventType: string): string {
  switch (eventType) {
    case 'grabbed': return 'GRABBED';
    case 'downloadFolderImported':
    case 'movieFileImported':
    case 'episodeFileImported':
    case 'imported': return 'IMPORTED';
    case 'downloadFailed':
    case 'failed': return 'DOWNLOAD FAILED';
    case 'movieFileDeleted':
    case 'episodeFileDeleted':
    case 'deleted': return 'FILE DELETED';
    case 'movieFileRenamed':
    case 'episodeFileRenamed':
    case 'renamed': return 'RENAMED';
    case 'downloadIgnored':
    case 'ignored': return 'IGNORED';
    default: return eventType.toUpperCase();
  }
}

function eventTypeBadgeVariant(eventType: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (eventType) {
    case 'grabbed': return 'secondary';
    case 'downloadFolderImported':
    case 'movieFileImported':
    case 'episodeFileImported':
    case 'imported': return 'default';
    case 'downloadFailed':
    case 'failed':
    case 'movieFileDeleted':
    case 'episodeFileDeleted':
    case 'deleted': return 'destructive';
    default: return 'outline';
  }
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(label);
  } catch {
    toast.error('Failed to copy');
  }
}

/**
 * A title's *arr history as tappable cards, with a details drawer. Shared by the
 * movie Files page and the series History page; `episodeLabel` names the episode
 * a series record belongs to (e.g. "S01E02"). `source` and `instanceId` (the
 * title's instance) let a grab or import be marked failed, as on Activity → History.
 */
export function ArrHistoryList({
  items,
  loading,
  episodeLabel,
  source,
  instanceId,
}: {
  items: HistoryItem[];
  loading: boolean;
  episodeLabel?: (item: HistoryItem) => string | null;
  source: 'sonarr' | 'radarr';
  instanceId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const canManage = useCan('activity.manage');
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);
  const selectedEpisode = selectedHistoryItem ? episodeLabel?.(selectedHistoryItem) ?? null : null;
  // Until the instance is known there is nothing to name, and canMarkFailed says no.
  const selectedEvent = selectedHistoryItem ? { ...selectedHistoryItem, source, instanceId } : null;

  return (
    <>
      {loading ? (
        <PageSpinner />
      ) : items.length === 0 ? (
        <div className="rounded-2xl border px-4 py-6 text-center text-sm text-muted-foreground">
          No history available
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => {
            const episode = episodeLabel?.(item) ?? null;
            const historyActions: ContextAction[] = [
              {
                id: 'details',
                label: 'View details',
                icon: <Info className="h-4 w-4" />,
                onSelect: () => setSelectedHistoryItem(item),
              },
              {
                id: 'copy-source-title',
                label: 'Copy source title',
                icon: <Copy className="h-4 w-4" />,
                onSelect: () => void copyText(item.sourceTitle, 'Source title copied'),
              },
            ];
            return (
            <QuickContextMenu
              key={`${item.id}-${item.date}-${index}`}
              label={`Actions for ${item.sourceTitle}`}
              actions={historyActions}
            >
              <button
                onClick={() => setSelectedHistoryItem(item)}
                className="w-full rounded-2xl border bg-card px-4 py-3 text-left active:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge variant={eventTypeBadgeVariant(item.eventType)} className="text-[10px]">
                      {eventTypeLabel(item.eventType)}
                    </Badge>
                    {episode && (
                      <span className="text-xs font-medium tabular-nums text-muted-foreground">{episode}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(item.date), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm mt-2 leading-tight [overflow-wrap:anywhere]">
                  {item.sourceTitle}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {[
                    item.quality?.quality?.name,
                    item.data?.languages,
                  ].filter(Boolean).join(' · ')}
                </p>
              </button>
            </QuickContextMenu>
            );
          })}
        </div>
      )}

      <Drawer open={!!selectedHistoryItem} onOpenChange={(open) => { if (!open) setSelectedHistoryItem(null); }}>
        <DrawerContent size="content">
          <DrawerHeader>
            <DrawerTitle>{selectedHistoryItem ? eventTypeLabel(selectedHistoryItem.eventType) : ''}</DrawerTitle>
            <DrawerDescription>
              {selectedHistoryItem?.date
                ? formatDateTime(new Date(selectedHistoryItem.date))
                : ''}
            </DrawerDescription>
          </DrawerHeader>
          {selectedHistoryItem && (
            <div className="px-4 pb-4 space-y-0 overflow-y-auto flex-1 min-h-0">
              <div className="rounded-lg border overflow-hidden divide-y">
                <div className="px-4 py-2.5">
                  <span className="shrink-0 text-xs text-muted-foreground uppercase tracking-wide">Release Title</span>
                  <p className="text-sm mt-0.5 leading-tight [overflow-wrap:anywhere]">
                    {selectedHistoryItem.sourceTitle}
                  </p>
                </div>
                {selectedEpisode && (
                  <div className="flex justify-between items-center gap-4 px-4 py-2.5">
                    <span className="shrink-0 text-xs text-muted-foreground uppercase tracking-wide">Episode</span>
                    <span className="min-w-0 text-right text-sm [overflow-wrap:anywhere]">{selectedEpisode}</span>
                  </div>
                )}
                <div className="flex justify-between items-center gap-4 px-4 py-2.5">
                  <span className="shrink-0 text-xs text-muted-foreground uppercase tracking-wide">Date</span>
                  <span className="min-w-0 text-right text-sm [overflow-wrap:anywhere]">
                    {formatDateTime(new Date(selectedHistoryItem.date))}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-4 px-4 py-2.5">
                  <span className="shrink-0 text-xs text-muted-foreground uppercase tracking-wide">Quality</span>
                  <span className="min-w-0 text-right text-sm [overflow-wrap:anywhere]">
                    {selectedHistoryItem.quality?.quality?.name || 'Unknown'}
                  </span>
                </div>
                {selectedHistoryItem.data?.indexer && (
                  <div className="flex justify-between items-center gap-4 px-4 py-2.5">
                    <span className="shrink-0 text-xs text-muted-foreground uppercase tracking-wide">Indexer</span>
                    <span className="min-w-0 text-right text-sm [overflow-wrap:anywhere]">{selectedHistoryItem.data.indexer}</span>
                  </div>
                )}
                {selectedHistoryItem.data?.downloadClient && (
                  <div className="flex justify-between items-center gap-4 px-4 py-2.5">
                    <span className="shrink-0 text-xs text-muted-foreground uppercase tracking-wide">Download Client</span>
                    <span className="min-w-0 text-right text-sm [overflow-wrap:anywhere]">{selectedHistoryItem.data.downloadClient}</span>
                  </div>
                )}
                {selectedHistoryItem.data?.releaseGroup && (
                  <div className="flex justify-between items-center gap-4 px-4 py-2.5">
                    <span className="shrink-0 text-xs text-muted-foreground uppercase tracking-wide">Release Group</span>
                    <span className="min-w-0 text-right text-sm [overflow-wrap:anywhere]">{selectedHistoryItem.data.releaseGroup}</span>
                  </div>
                )}
                {selectedHistoryItem.data?.nzbInfoUrl && (
                  <div className="flex justify-between items-center gap-4 px-4 py-2.5">
                    <span className="shrink-0 text-xs text-muted-foreground uppercase tracking-wide">Source</span>
                    <a
                      href={selectedHistoryItem.data.nzbInfoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary flex items-center gap-1"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
                {selectedHistoryItem.data?.size && (
                  <div className="flex justify-between items-center gap-4 px-4 py-2.5">
                    <span className="shrink-0 text-xs text-muted-foreground uppercase tracking-wide">Size</span>
                    <span className="min-w-0 text-right text-sm [overflow-wrap:anywhere]">{formatBytes(Number(selectedHistoryItem.data.size))}</span>
                  </div>
                )}
                {selectedHistoryItem.data?.protocol && (
                  <div className="flex justify-between items-center gap-4 px-4 py-2.5">
                    <span className="shrink-0 text-xs text-muted-foreground uppercase tracking-wide">Protocol</span>
                    <span className="min-w-0 text-right text-sm [overflow-wrap:anywhere]">{formatDownloadProtocol(selectedHistoryItem.data.protocol)}</span>
                  </div>
                )}
                {selectedHistoryItem.data?.message && (
                  <div className="px-4 py-2.5">
                    <span className="shrink-0 text-xs text-muted-foreground uppercase tracking-wide">Message</span>
                    <p className="text-sm mt-0.5 text-muted-foreground">{selectedHistoryItem.data.message}</p>
                  </div>
                )}
              </div>
              {canManage && selectedEvent && canMarkFailed(selectedEvent) && (
                <div className="pt-4">
                  <MarkFailedButton
                    key={`${source}-${instanceId}-${selectedEvent.id}`}
                    item={selectedEvent}
                    onDone={() => {
                      setSelectedHistoryItem(null);
                      // The title's history gains a failed event (Activity refreshes itself).
                      void queryClient.invalidateQueries({ queryKey: [source, 'history'] });
                    }}
                  />
                </div>
              )}
              <div className="pt-4">
                <DrawerClose asChild>
                  <Button variant="ghost" className="w-full">
                    Close
                  </Button>
                </DrawerClose>
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
