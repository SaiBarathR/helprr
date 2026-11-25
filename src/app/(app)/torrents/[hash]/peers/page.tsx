'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowUpDown, Ban, Loader2, MoreVertical, Plus, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ErrorState } from '@/components/ui/error-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Progress } from '@/components/ui/progress';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { ResponsiveMenu, ResponsiveMenuCheckboxItem } from '@/components/ui/responsive-menu';
import { Textarea } from '@/components/ui/textarea';
import { useCan, useMe } from '@/components/permission-provider';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { ApiError, withInstanceQuery } from '@/lib/query-fetch';
import { qbitInstanceKey, useQbitInstance } from '../../_components/use-qbit-instance';
import {
  PEER_SORTS,
  countryFlag,
  mergePeers,
  sortPeers,
  type PeerSort,
  type PeerView,
  type PeersDelta,
  type PeersState,
} from '@/lib/qbittorrent-peer-view';
import { formatBytes, formatSpeed } from '../../_components/torrent-list';

async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  // ApiError so a 401 reaches the global MutationCache handler (redirect).
  if (!res.ok) throw new ApiError(res.status, data?.error || fallback);
  return data as T;
}

const peerLabel = (count: number) => `${count} peer${count === 1 ? '' : 's'}`;
const percent = (value: number | undefined) => `${Math.round((value ?? 0) * 100)}%`;

export default function TorrentPeersPage() {
  const { hash } = useParams<{ hash: string }>();
  const torrentName = useSearchParams().get('name') || undefined;
  const canManage = useCan('torrents.manage');
  // Only an admin is sent addresses and may ban (a ban is global); UX only, the server decides.
  const isAdmin = useMe()?.role === 'admin';
  const queryClient = useQueryClient();
  const { instanceId } = useQbitInstance();
  const peersKey = useMemo(() => ['qbittorrent', hash, 'peers', qbitInstanceKey(instanceId)] as const, [hash, instanceId]);

  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);
  useEffect(() => {
    void getRefreshIntervalMs('torrentsRefreshIntervalSecs', 5).then(setRefreshIntervalMs);
  }, []);

  // Each poll asks for what changed since the list this page holds (its
  // cursor) and merges that in; the server sends the whole list when it can't.
  const peersQuery = useQuery({
    queryKey: peersKey,
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<PeersState>(peersKey);
      const query = previous ? `?cursor=${encodeURIComponent(previous.cursor)}` : '';
      const res = await fetch(withInstanceQuery(`/api/qbittorrent/${hash}/peers${query}`, instanceId), { signal });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.error || 'Failed to load the peers');
      return mergePeers(previous, data as PeersDelta);
    },
    refetchInterval: refreshIntervalMs,
    refetchIntervalInBackground: false,
  });

  const [sort, setSort] = useState<PeerSort>('dl_speed');
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [banning, setBanning] = useState<{ key: string; peer: Partial<PeerView> } | null>(null);

  const addMutation = useMutation({
    mutationFn: (peers: string[]) =>
      postJson<{ requested: number; added: number | null; failed: number | null }>(withInstanceQuery(`/api/qbittorrent/${hash}/peers`, instanceId), { peers }, 'Failed to add peers'),
  });
  const banMutation = useMutation({
    mutationFn: (key: string) => postJson<{ banned: true }>(withInstanceQuery(`/api/qbittorrent/${hash}/peers/ban`, instanceId), { key }, 'Failed to ban the peer'),
  });
  const busy = addMutation.isPending || banMutation.isPending;

  const failed = (err: unknown, fallback: string) => {
    // 401 is handled globally (redirect to /login); only toast other failures.
    if (!(err instanceof ApiError && err.status === 401)) toast.error(err instanceof Error ? err.message : fallback);
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const peers = addValue.split('\n').map((line) => line.trim()).filter(Boolean);
    if (peers.length === 0) return;
    try {
      const result = await addMutation.mutateAsync(peers);
      setAddValue('');
      setAdding(false);
      // qBittorrent only tries them: a peer shows in the list once it connects.
      if (result.added === null) toast.success(`Sent ${peerLabel(result.requested)} to qBittorrent`);
      else if (result.failed) toast.info(`Added ${peerLabel(result.added)}, ${result.failed} failed`);
      else toast.success(`Added ${peerLabel(result.added)}`);
      void peersQuery.refetch();
    } catch (err) {
      failed(err, 'Failed to add peers');
    }
  };

  const confirmBan = async () => {
    if (!banning) return;
    try {
      await banMutation.mutateAsync(banning.key);
      toast.success('Peer banned');
    } catch (err) {
      failed(err, 'Failed to ban the peer');
    }
    setBanning(null);
    void peersQuery.refetch();
  };

  const state = peersQuery.data;
  // A private torrent's peers come from its tracker only: adding one is an
  // admin's call, and unknown counts as private. UX only, the route decides.
  const privateLocked = canManage && !isAdmin && state?.private !== false;
  const canAdd = canManage && !privateLocked;
  const title = canManage ? 'Manage Peers' : 'Peers';
  // The order as last shown, so a poll keeps it rather than re-sorting (sortPeers).
  // Picking a sort, even the one already chosen, sorts afresh.
  const [shown, setShown] = useState<{ peers: PeersState['peers']; sort: PeerSort; keys: string[] } | null>(null);
  if (state && (shown?.peers !== state.peers || shown.sort !== sort)) {
    const previous = shown?.sort === sort ? shown.keys : undefined;
    setShown({ peers: state.peers, sort, keys: sortPeers(state.peers, sort, previous).map(([key]) => key) });
  }
  const rows = useMemo(
    () => (state && shown?.peers === state.peers ? shown.keys.map((key): [string, Partial<PeerView>] => [key, state.peers[key]]) : []),
    [state, shown],
  );

  const toolbar = (
    <>
      <ResponsiveMenu
        title="Sort by"
        closeOnPick
        titleInDropdown
        align="end"
        contentClassName="w-52"
        trigger={(
          <button
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
            aria-label="Sort peers"
          >
            <ArrowUpDown className="h-5 w-5" />
          </button>
        )}
      >
        {PEER_SORTS.map((option) => (
          <ResponsiveMenuCheckboxItem key={option.key} checked={sort === option.key} onCheckedChange={() => { setSort(option.key); setShown(null); }}>
            {option.label}
          </ResponsiveMenuCheckboxItem>
        ))}
      </ResponsiveMenu>
      {canAdd && (
        <button
          className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
          aria-label={adding ? 'Close add peers' : 'Add peers'}
          aria-expanded={adding}
          onClick={() => setAdding((open) => !open)}
        >
          {adding ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        </button>
      )}
    </>
  );
  const header = <PageHeader title={title} subtitle={torrentName} backHref="/torrents" rightContent={toolbar} />;

  if (peersQuery.isLoading) return <>{header}<PageSpinner /></>;

  if (!state) {
    return (
      <>
        {header}
        <ErrorState
          message={peersQuery.error instanceof ApiError && peersQuery.error.status === 404
            ? 'This torrent is no longer in qBittorrent.'
            : 'Failed to load the peers.'}
          onRetry={() => void peersQuery.refetch()}
          retrying={peersQuery.isFetching}
        />
      </>
    );
  }

  return (
    <div className="animate-content-in">
      {header}

      <div className="mt-3 pb-8">
        {canAdd && adding && (
          <GroupedSection
            title="Add Peers"
            footer="One IP:port per line, IPv6 as [address]:port. qBittorrent tries to connect to them; one that answers shows in the list."
          >
            <form className="grouped-row grouped-row-stacked gap-2" onSubmit={add}>
              <Textarea
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                placeholder={'203.0.113.5:6881\n[2001:db8::5]:6881'}
                aria-label="Peers to add"
                rows={3}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
                autoFocus
              />
              <Button type="submit" disabled={busy || !addValue.trim()}>
                {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Peers
              </Button>
            </form>
          </GroupedSection>
        )}

        <GroupedSection
          title={`Peers (${rows.length})`}
          footer={isAdmin
            ? undefined
            : privateLocked
              ? 'Only admins see peer IP addresses. This torrent is private: only an admin can add peers to it.'
              : 'Only admins see peer IP addresses.'}
        >
          {peersQuery.isError && (
            <div className="grouped-row" role="status">
              <span className="text-xs text-destructive">Couldn’t refresh the peers. This is the last list Helprr got.</span>
            </div>
          )}
          {rows.length === 0 && (
            <div className="grouped-row">
              <span className="text-sm text-muted-foreground">No peers connected right now</span>
            </div>
          )}
          {rows.map(([key, peer]) => {
            const name = peer.client || peer.peer_id_client || 'Unknown client';
            const label = isAdmin && peer.address ? `${name} at ${peer.address}` : name;
            const flag = state.showFlags === false ? '' : countryFlag(peer.country_code);
            return (
              <QuickContextMenu
                key={key}
                label={`Actions for ${label}`}
                // Long-press bans too; the row's ⋮ is the other way in.
                allowSingleAction
                groups={[
                  {
                    id: 'peer',
                    actions: isAdmin
                      ? [{ id: 'ban-peer', label: 'Ban peer', icon: <Ban className="h-4 w-4" />, destructive: true, disabled: busy, onSelect: () => setBanning({ key, peer }) }]
                      : [],
                  },
                ]}
              >
                <div className="grouped-row grouped-row-stacked gap-1.5">
                  <div className="flex items-start gap-2 w-full">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-sm break-words">
                        {flag && <span className="mr-1.5" role="img" aria-label={peer.country || peer.country_code}>{flag}</span>}
                        {name}
                      </p>
                      <p className="text-xs text-muted-foreground break-words">
                        {[isAdmin ? peer.address : null, peer.connection, peer.country].filter(Boolean).join(' · ')}
                        {/* qBittorrent's letters (D, H, X…), explained in flags_desc. */}
                        {peer.flags && (
                          <span title={peer.flags_desc}>
                            {(isAdmin && peer.address) || peer.connection || peer.country ? ' · ' : ''}
                            {peer.flags}
                            {peer.flags_desc && <span className="sr-only">: {peer.flags_desc.replace(/\n/g, ', ')}</span>}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums space-y-0.5">
                      <p>↓ {formatSpeed(peer.dl_speed ?? 0)}</p>
                      <p className="text-muted-foreground">↑ {formatSpeed(peer.up_speed ?? 0)}</p>
                    </div>
                    {isAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="-my-2 -mr-3 size-11 shrink-0"
                            aria-label={`More actions for ${label}`}
                            disabled={busy}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem variant="destructive" onClick={() => setBanning({ key, peer })}>
                            <Ban className="h-4 w-4" /> Ban peer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <div className="flex items-center gap-2 w-full">
                    <Progress value={(peer.progress ?? 0) * 100} className="h-1 flex-1" aria-label={`${name} has ${percent(peer.progress)}`} />
                    <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{percent(peer.progress)}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground break-words">
                    Downloaded {formatBytes(peer.downloaded ?? 0)} &middot; Uploaded {formatBytes(peer.uploaded ?? 0)} &middot; Relevance {percent(peer.relevance)}
                  </p>
                </div>
              </QuickContextMenu>
            );
          })}
        </GroupedSection>
      </div>

      <ConfirmDialog
        open={!!banning}
        onOpenChange={(open) => { if (!open && !banMutation.isPending) setBanning(null); }}
        title="Ban this peer?"
        description={
          <>
            <span className="break-all">{banning?.peer.address ?? banning?.peer.client}</span>
            <br />
            qBittorrent bans this IP address for every torrent and keeps it banned until it is removed in
            qBittorrent under Options › Connection › IP Filtering.
          </>
        }
        confirmLabel="Ban Peer"
        destructive
        busy={banMutation.isPending}
        onConfirm={confirmBan}
      />
    </div>
  );
}
