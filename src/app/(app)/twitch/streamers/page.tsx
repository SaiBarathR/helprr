'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, ChevronRight, ExternalLink, Info, Plus, Radio, RefreshCw, SlidersHorizontal, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { useMe, hasCapability } from '@/components/permission-provider';
import { SearchBar } from '@/components/media/search-bar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { QuickContextMenu, type ContextActionGroup } from '@/components/ui/quick-context-menu';
import { SwipeRow } from '@/components/ui/swipe-row';
import { ImportFollows } from '@/components/twitch/import-follows';
import { StreamerAvatar } from '@/components/twitch/streamer-avatar';
import { ToolbarButton, TwitchToolbar } from '@/components/twitch/twitch-toolbar';
import { useRouteViewState } from '@/lib/hooks/use-route-view-state';

interface Subscription {
  id: string;
  notifyNewVods: boolean;
  streamer: {
    id: string;
    login: string;
    displayName: string;
    profileImageUrl: string | null;
    isLive: boolean;
    liveTitle: string | null;
  };
}

interface StreamerList {
  subscriptions: Subscription[];
}

const QUERY_KEY = ['twitch', 'streamers'];

function StreamerRow({ subscription, canManage, onToggleNotify, onUnsubscribe }: {
  subscription: Subscription;
  canManage: boolean;
  onToggleNotify: () => void;
  onUnsubscribe: () => void;
}) {
  const { notifyNewVods, streamer } = subscription;
  const name = streamer.displayName;
  const NotifyIcon = notifyNewVods ? BellOff : Bell;
  const notifyLabel = notifyNewVods ? 'Turn off notifications' : 'Turn on notifications';
  const groups: ContextActionGroup[] = [
    {
      id: 'open',
      actions: [
        { id: 'open', label: 'View streamer', icon: <Info className="h-4 w-4" />, href: `/twitch/streamers/${streamer.id}` },
        ...(canManage
          ? [{ id: 'rules', label: 'Download rules', icon: <SlidersHorizontal className="h-4 w-4" />, href: `/twitch/streamers/${streamer.id}/rules` }]
          : []),
        { id: 'twitch', label: 'Open on Twitch', icon: <ExternalLink className="h-4 w-4" />, href: `https://www.twitch.tv/${streamer.login}`, external: true },
      ],
    },
    { id: 'notify', actions: [{ id: 'notify', label: notifyLabel, icon: <NotifyIcon className="h-4 w-4" />, onSelect: onToggleNotify }] },
    { id: 'destructive', actions: [{ id: 'unsubscribe', label: 'Unsubscribe', icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: onUnsubscribe }] },
  ];

  return (
    <SwipeRow
      contentClassName="bg-card"
      leftAction={{
        label: notifyNewVods ? 'Mute' : 'Notify',
        icon: <NotifyIcon className="h-4 w-4" />,
        className: 'bg-primary text-primary-foreground',
        onAction: onToggleNotify,
      }}
      rightAction={{
        label: 'Remove',
        icon: <Trash2 className="h-4 w-4" />,
        className: 'bg-destructive text-destructive-foreground',
        onAction: onUnsubscribe,
      }}
    >
      <QuickContextMenu label={`${name} actions`} groups={groups}>
        <div className="relative flex items-center gap-3 px-3 py-2.5">
          <StreamerAvatar url={streamer.profileImageUrl} />
          <div className="min-w-0 flex-1">
            {/* Stretched over the row; the bell sits above it. */}
            <Link
              href={`/twitch/streamers/${streamer.id}`}
              data-context-menu-row
              className="block truncate text-sm font-medium after:absolute after:inset-0"
            >
              {name}
            </Link>
            {streamer.isLive ? (
              <p className="flex items-center gap-1 text-[11px] text-red-400">
                <Radio className="h-3 w-3 shrink-0" />
                <span className="truncate">{streamer.liveTitle || 'Live'}</span>
              </p>
            ) : (
              <p className="truncate text-[11px] text-muted-foreground">@{streamer.login}</p>
            )}
          </div>
          <button
            type="button"
            aria-label={`${notifyLabel} for ${name}`}
            aria-pressed={notifyNewVods}
            onClick={onToggleNotify}
            className="relative flex h-11 w-9 shrink-0 items-center justify-center"
          >
            {notifyNewVods ? <Bell className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
          </button>
          <ChevronRight className="-ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </QuickContextMenu>
    </SwipeRow>
  );
}

export default function TwitchStreamersPage() {
  const queryClient = useQueryClient();
  const canManage = hasCapability(useMe(), 'twitch.manage');
  const [search, setSearch] = useRouteViewState('search', '');
  const [importOpen, setImportOpen] = useState(false);
  const [leaving, setLeaving] = useState<Subscription | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['twitch'] });

  const list = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/twitch/streamers', { signal });
      if (!res.ok) throw new Error('Failed to load streamers');
      return (await res.json()) as StreamerList;
    },
  });
  const subscriptions = useMemo(() => list.data?.subscriptions ?? [], [list.data]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return subscriptions;
    return subscriptions.filter(({ streamer }) => streamer.displayName.toLowerCase().includes(term) || streamer.login.includes(term));
  }, [subscriptions, search]);

  const toggleNotify = useMutation({
    mutationFn: async ({ id, notifyNewVods }: { id: string; notifyNewVods: boolean }) => {
      const res = await fetch(`/api/twitch/subscriptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyNewVods }),
      });
      if (!res.ok) throw new Error('Could not change notifications');
    },
    // The bell answers the tap; a failure puts it back.
    onMutate: ({ id, notifyNewVods }) => {
      queryClient.setQueryData<StreamerList>(QUERY_KEY, (data) => data && {
        subscriptions: data.subscriptions.map((item) => (item.id === id ? { ...item, notifyNewVods } : item)),
      });
    },
    onSettled: () => void refresh(),
    onError: (error) => toast.error(error.message),
  });

  const unsubscribe = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/twitch/subscriptions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not unsubscribe');
    },
    onSuccess: () => {
      setLeaving(null);
      void refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-3 animate-content-in">
      <PullToRefresh onRefresh={refresh} />
      <h1 className="sr-only">Streamers</h1>
      <TwitchToolbar
        active="streamers"
        actions={(
          <ToolbarButton label="Refresh" disabled={list.isRefetching} onClick={() => void refresh()}>
            <RefreshCw className={`h-5 w-5 ${list.isRefetching ? 'animate-spin' : ''}`} />
          </ToolbarButton>
        )}
        trailing={(
          <>
            <ToolbarButton label="Import who you follow" onClick={() => setImportOpen(true)}>
              <UserPlus className="h-5 w-5" />
            </ToolbarButton>
            <ToolbarButton label="Add streamer" href="/twitch/streamers/add" filled>
              <Plus className="h-5 w-5" />
            </ToolbarButton>
          </>
        )}
      >
        <SearchBar value={search} onChange={setSearch} placeholder="Search..." debounceMs={150} />
      </TwitchToolbar>

      {list.isLoading ? (
        <ListSkeleton count={6} />
      ) : list.isError ? (
        <ErrorState message="Couldn't load your streamers" onRetry={() => void list.refetch()} />
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          <p>{subscriptions.length === 0 ? 'No streamers yet.' : 'No streamers match your search.'}</p>
          {subscriptions.length === 0 && (
            <Button asChild variant="outline" size="sm" className="mt-3"><Link href="/twitch/streamers/add">Add streamer</Link></Button>
          )}
        </div>
      ) : (
        <div>
          <p className="px-1 pb-2 text-xs text-muted-foreground">{visible.length} {visible.length === 1 ? 'streamer' : 'streamers'}</p>
          <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card">
            {visible.map((subscription) => (
              <StreamerRow
                key={subscription.id}
                subscription={subscription}
                canManage={canManage}
                onToggleNotify={() => toggleNotify.mutate({ id: subscription.id, notifyNewVods: !subscription.notifyNewVods })}
                onUnsubscribe={() => setLeaving(subscription)}
              />
            ))}
          </div>
        </div>
      )}

      <ImportFollows open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => { if (!open) setLeaving(null); }}
        title={`Unsubscribe from ${leaving?.streamer.displayName}?`}
        description="Their videos leave your feed. Anything already downloaded stays in your library."
        confirmLabel="Unsubscribe"
        destructive
        busy={unsubscribe.isPending}
        onConfirm={() => { if (leaving) unsubscribe.mutate(leaving.id); }}
      />
    </div>
  );
}
