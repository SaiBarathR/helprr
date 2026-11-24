'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Copy, Info, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { formatDateTime } from '@/lib/date-format';
import { toast } from 'sonner';
import { withAppName } from '@/components/instance-filter';
import type { BlocklistItem } from '@/types';

// A blocklist entry's row and detail sheet, and its removal: shared by Activity →
// Blocklist and a title's own blocklist (movie Files, series History).

export type BlocklistRecord = BlocklistItem & {
  source: 'sonarr' | 'radarr' | 'lidarr';
  instanceId: string;
  instanceLabel: string;
};

export const recordKey = (item: BlocklistRecord) => `${item.source}-${item.instanceId}-${item.id}`;

function mediaTitle(item: BlocklistRecord): string | undefined {
  if (item.series?.title) return item.series.title;
  if (item.movie?.title) return item.movie.year ? `${item.movie.title} (${item.movie.year})` : item.movie.title;
  return item.artist?.artistName;
}

function timeAgo(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Remove entries, one request per instance (entry ids are per instance).
 * Resolves to how many entries each outcome covered.
 */
export async function removeEntries(entries: BlocklistRecord[]): Promise<{ removed: number; failed: number }> {
  const groups = new Map<string, BlocklistRecord[]>();
  for (const entry of entries) {
    const key = `${entry.source}:${entry.instanceId}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const results = await Promise.all([...groups.values()].map(async (group) => {
    const res = await fetch('/api/activity/blocklist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: group[0].source,
        instanceId: group[0].instanceId,
        ids: group.map((entry) => entry.id),
      }),
    }).catch(() => null);
    return { ok: !!res?.ok, count: group.length };
  }));
  return results.reduce(
    (sum, r) => (r.ok ? { ...sum, removed: sum.removed + r.count } : { ...sum, failed: sum.failed + r.count }),
    { removed: 0, failed: 0 },
  );
}

export function BlocklistRow({
  item,
  selectable,
  selected,
  onSelect,
  onRemove,
}: {
  item: BlocklistRecord;
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const title = mediaTitle(item);
  return (
    <QuickContextMenu
      label={`Actions for ${item.sourceTitle}`}
      disabled={selectable}
      groups={[
        {
          id: 'navigation',
          actions: [{ id: 'view-details', label: 'View details', icon: <Info className="h-4 w-4" />, onSelect }],
        },
        {
          id: 'copy',
          actions: [{
            id: 'copy-source-title',
            label: 'Copy source title',
            icon: <Copy className="h-4 w-4" />,
            onSelect: () => void navigator.clipboard.writeText(item.sourceTitle).then(
              () => toast.success('Source title copied'),
              () => toast.error('Copy failed'),
            ),
          }],
        },
        ...(onRemove
          ? [{
            id: 'remove',
            actions: [{
              id: 'remove',
              label: 'Remove from blocklist',
              icon: <Trash2 className="h-4 w-4" />,
              destructive: true,
              onSelect: onRemove,
            }],
          }]
          : []),
      ]}
    >
      <button
        onClick={onSelect}
        aria-pressed={selectable ? selected : undefined}
        className="-mx-2 w-[calc(100%+1rem)] text-left flex items-start gap-3 py-2.5 px-2 rounded-lg hover:bg-muted/50 active:bg-muted/50 transition-colors md:-mx-3 md:w-[calc(100%+1.5rem)] md:px-3"
      >
        {selectable && <Checkbox checked={selected} tabIndex={-1} aria-hidden className="mt-0.5 pointer-events-none" />}
        <div className="flex-1 min-w-0 space-y-1">
          {title && <p className="text-xs text-muted-foreground truncate">{title}</p>}

          {/* Release name: up to two lines (the drawer has the full name) */}
          <p className="text-sm leading-snug break-words line-clamp-2">{item.sourceTitle}</p>

          <div className="flex items-center gap-1.5 flex-wrap">
            {item.quality?.quality?.name && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">{item.quality.quality.name}</Badge>
            )}
            {item.indexer && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">{item.indexer}</Badge>
            )}
            {item.protocol && item.protocol !== 'unknown' && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">{item.protocol}</Badge>
            )}
            <Badge variant="outline" className="text-[9px] px-1.5 py-0">{item.source}</Badge>
          </div>
        </div>

        <span className="text-[10px] text-muted-foreground shrink-0 mt-1 tabular-nums">{timeAgo(item.date)}</span>
      </button>
    </QuickContextMenu>
  );
}

export function BlocklistDrawer({
  item,
  onClose,
  onRemove,
}: {
  item: BlocklistRecord | null;
  onClose: () => void;
  onRemove?: (item: BlocklistRecord) => void;
}) {
  const date = item ? new Date(item.date) : null;
  return (
    <Drawer open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent>
        {item && (
          <>
            <DrawerHeader className="text-left">
              <Badge
                variant="secondary"
                className="w-fit text-[10px] px-2 py-0.5 font-semibold bg-red-500/10 text-red-400 border-red-500/20"
              >
                BLOCKLISTED
              </Badge>
              <DrawerTitle className="text-sm break-all leading-snug mt-1">{item.sourceTitle}</DrawerTitle>
              <p className="text-xs text-muted-foreground">{mediaTitle(item)}</p>
            </DrawerHeader>

            <div className="px-4 space-y-4 pb-6 overflow-y-auto flex-1 min-h-0">
              {item.message && (
                <div className="rounded-lg bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Message</p>
                  <p className="text-sm break-words">{item.message}</p>
                </div>
              )}

              <div>
                <h3 className="font-semibold text-sm mb-2">Information</h3>
                <div className="space-y-0 rounded-lg border divide-y">
                  <InfoRow label="Quality" value={item.quality?.quality?.name || '-'} />
                  <InfoRow label="Indexer" value={item.indexer || '-'} />
                  <InfoRow label="Protocol" value={item.protocol || '-'} />
                  <InfoRow
                    label="Date"
                    value={date && !Number.isNaN(date.getTime()) ? `${formatDateTime(date)} (${timeAgo(item.date)})` : '-'}
                  />
                  <InfoRow label="Instance" value={withAppName(item.instanceLabel, item.source)} />
                </div>
              </div>

              {onRemove && (
                <Button variant="destructive" className="w-full h-11" onClick={() => onRemove(item)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove from blocklist
                </Button>
              )}
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
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
