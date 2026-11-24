'use client';

import { useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/page-spinner';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { Textarea } from '@/components/ui/textarea';
import { useCan, useMe } from '@/components/permission-provider';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import type { TorrentTracker } from '@/lib/qbittorrent-client';
import { trackerCount, trackerStatusLabel } from '../../_components/torrent-trackers';

/** Where the tracker was seen, which is how the server finds it again (it may hold the URL back from this user). */
interface TrackerRef {
  index: number;
  shown: string;
  tier: number;
  count: number;
}

type TrackerChange =
  | { action: 'add'; urls: string[] }
  | ({ action: 'edit'; url: string } & TrackerRef)
  | ({ action: 'remove' } & TrackerRef);

/** The tracker list after the change, as this user may see it; null when the server could not read it back. */
async function postTrackerChange(hash: string, change: TrackerChange): Promise<TorrentTracker[] | null> {
  const res = await fetch(`/api/qbittorrent/${hash}/trackers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  });
  const data = await res.json().catch(() => null);
  // ApiError so a 401 reaches the global MutationCache handler (redirect).
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Failed to change trackers');
  return Array.isArray(data?.trackers) ? data.trackers : null;
}

const isPseudoTracker = (tracker: TorrentTracker) => tracker.url.startsWith('** [');

const sameRef = (a: TrackerRef, b: TrackerRef) =>
  a.index === b.index && a.shown === b.shown && a.tier === b.tier && a.count === b.count;

const trackerLabel = (count: number) => `${count} tracker${count === 1 ? '' : 's'}`;

export default function TorrentTrackersPage() {
  const { hash } = useParams<{ hash: string }>();
  const torrentName = useSearchParams().get('name') || undefined;
  const canManage = useCan('torrents.manage');
  // Only an admin is sent full URLs (anyone else gets each tracker's host); UX only, the server decides.
  const fullUrls = useMe()?.role === 'admin';
  const queryClient = useQueryClient();
  const trackersKey = ['qbittorrent', hash, 'trackers'] as const;

  // A private torrent's trackers are an admin's to change; the route decides, and a
  // torrent qBittorrent doesn't call public counts as private. Read with the list.
  const [isPrivate, setIsPrivate] = useState<boolean | null>(null);
  const trackersQuery = useQuery({
    queryKey: trackersKey,
    queryFn: async ({ signal }) => {
      const details = await jsonFetcher<{ trackers: TorrentTracker[]; private?: boolean | null }>(`/api/qbittorrent/${hash}/details`)({ signal });
      setIsPrivate(details.private ?? null);
      return details.trackers ?? [];
    },
  });
  const all = trackersQuery.data;
  const privateLocked = canManage && !fullUrls && isPrivate !== false;
  const editable = canManage && !privateLocked;

  const [editing, setEditing] = useState<TrackerRef | null>(null);
  const [editValue, setEditValue] = useState('');
  const [removing, setRemoving] = useState<TrackerRef | null>(null);
  const [addValue, setAddValue] = useState('');

  const { mutateAsync, isPending } = useMutation({
    mutationFn: (change: TrackerChange) => postTrackerChange(hash, change),
  });

  /** Posts one change and shows its result; false once the failure has been toasted. */
  const change = async (body: TrackerChange): Promise<TorrentTracker[] | false> => {
    try {
      const trackers = await mutateAsync(body);
      if (trackers) queryClient.setQueryData(trackersKey, trackers);
      else void trackersQuery.refetch();
      return trackers ?? [];
    } catch (err) {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error(err instanceof Error ? err.message : 'Failed to change trackers');
      }
      // The list moved under this page: show it as it is now, and close an edit
      // opened on the old one (one refused as already listed stays open to fix).
      if (err instanceof ApiError && err.status === 409) {
        void trackersQuery.refetch();
        if (/changed/.test(err.message)) setEditing(null);
      }
      return false;
    }
  };

  const startEdit = (ref: TrackerRef) => {
    setEditing(ref);
    // An admin edits the URL in place; anyone else types a new one, never having been sent the old.
    setEditValue(fullUrls ? ref.shown : '');
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || !editValue.trim()) return;
    if (await change({ action: 'edit', ...editing, url: editValue.trim() })) {
      setEditing(null);
      toast.success('Tracker updated');
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    if (await change({ action: 'remove', ...removing })) toast.success('Tracker removed');
    setRemoving(null);
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const urls = addValue.split('\n').map((line) => line.trim()).filter(Boolean);
    if (urls.length === 0) return;
    const before = all?.length ?? 0;
    const after = await change({ action: 'add', urls });
    if (after === false) return;
    setAddValue('');
    // qBittorrent skips URLs the torrent already has.
    const added = after.length - before;
    if (after.length > 0 && added <= 0) toast.info(urls.length === 1 ? 'That tracker is already on this torrent' : 'Those trackers are already on this torrent');
    else toast.success(after.length > 0 ? `Added ${trackerLabel(added)}` : 'Trackers added');
  };

  const title = editable ? 'Manage Trackers' : 'Trackers';

  if (trackersQuery.isLoading) {
    return <><PageHeader title={title} subtitle={torrentName} backHref="/torrents" /><PageSpinner /></>;
  }

  if (!all) {
    return (
      <>
        <PageHeader title={title} subtitle={torrentName} backHref="/torrents" />
        <ErrorState
          message={trackersQuery.error instanceof ApiError && trackersQuery.error.status === 404
            ? 'This torrent is no longer in qBittorrent.'
            : 'Failed to load the trackers.'}
          onRetry={() => void trackersQuery.refetch()}
          retrying={trackersQuery.isFetching}
        />
      </>
    );
  }

  // qBittorrent's own places, kept for the server; DHT, PeX and LSD are not listed here.
  const rows = all
    .map((tracker, index) => ({ tracker, ref: { index, shown: tracker.url, tier: tracker.tier, count: all.length } }))
    .filter(({ tracker }) => !isPseudoTracker(tracker));

  return (
    <div className="animate-content-in">
      <PageHeader title={title} subtitle={torrentName} backHref="/torrents" />

      <div className="mt-3 pb-8">
        <GroupedSection
          title={`Trackers (${rows.length})`}
          footer={privateLocked
            ? 'This torrent is private: only an admin can change its trackers.'
            : editable && !fullUrls
              ? 'Only admins see full tracker URLs. To change one, type its whole new announce URL, passkey included.'
              : undefined}
        >
          {rows.length === 0 && (
            <div className="grouped-row">
              <span className="text-sm text-muted-foreground">No trackers</span>
            </div>
          )}
          {rows.map(({ tracker, ref }) =>
            // A refetch can reorder the list: the form stays with the tracker it was opened on, or closes.
            editing && sameRef(editing, ref) ? (
              <form key={ref.index} className="grouped-row grouped-row-stacked gap-2" onSubmit={saveEdit}>
                <p className="text-xs text-muted-foreground break-all">
                  {fullUrls ? 'Edit tracker' : `Replace ${tracker.url}`}
                </p>
                <Input
                  type="url"
                  inputMode="url"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder={`${tracker.url}/announce`}
                  aria-label="New tracker URL"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={isPending}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1" disabled={isPending || !editValue.trim() || editValue.trim() === ref.shown}>
                    {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save
                  </Button>
                  <Button type="button" variant="outline" className="flex-1" disabled={isPending} onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <QuickContextMenu
                key={ref.index}
                label={`Actions for ${tracker.url}`}
                groups={[
                  {
                    id: 'tracker',
                    actions: editable
                      ? [
                          { id: 'edit-tracker', label: 'Edit tracker', icon: <Pencil className="h-4 w-4" />, disabled: isPending, onSelect: () => startEdit(ref) },
                          { id: 'remove-tracker', label: 'Remove tracker', icon: <Trash2 className="h-4 w-4" />, destructive: true, disabled: isPending, onSelect: () => setRemoving(ref) },
                        ]
                      : [],
                  },
                ]}
              >
                <div className="grouped-row gap-2">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm break-all">{tracker.url}</p>
                    <p className="text-xs text-muted-foreground break-words">
                      {trackerStatusLabel(tracker.status)} &middot; Tier {tracker.tier} &middot; Seeds:{' '}
                      {trackerCount(tracker.num_seeds)} &middot; Leechers: {trackerCount(tracker.num_leeches)}
                      {tracker.msg && ` · ${tracker.msg}`}
                    </p>
                  </div>
                  {editable && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="-my-2 -mr-3 size-11 shrink-0"
                          aria-label={`More actions for ${tracker.url}`}
                          disabled={isPending}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => startEdit(ref)}>
                          <Pencil className="h-4 w-4" /> Edit tracker
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setRemoving(ref)}>
                          <Trash2 className="h-4 w-4" /> Remove tracker
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </QuickContextMenu>
            ),
          )}
          {editable && (
            <form className="grouped-row grouped-row-stacked gap-2" onSubmit={add}>
              <Textarea
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                placeholder="One announce URL per line"
                aria-label="Trackers to add"
                rows={3}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={isPending}
              />
              <Button type="submit" disabled={isPending || !addValue.trim()}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Trackers
              </Button>
            </form>
          )}
        </GroupedSection>
      </div>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => { if (!open && !isPending) setRemoving(null); }}
        title="Remove this tracker?"
        description={
          <>
            <span className="break-all">{removing?.shown}</span>
            <br />
            Adding a private tracker back needs its full announce URL, passkey included.
          </>
        }
        confirmLabel="Remove"
        destructive
        busy={isPending}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
