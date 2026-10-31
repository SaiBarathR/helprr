'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Link2, Loader2, Plus, Search, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/media/search-input';
import { ImportFollows } from '@/components/twitch/import-follows';
import { StreamerAvatar } from '@/components/twitch/streamer-avatar';

interface ChannelResult {
  twitchUserId: string;
  login: string;
  displayName: string;
  profileImageUrl: string | null;
  isLive: boolean;
  category: string | null;
}

interface StreamerList {
  subscriptions: Array<{ streamer: { login: string } }>;
}

// Text fields live on a page, not in a drawer: the iOS keyboard pushes a drawer out of view.
export default function AddStreamerPage() {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const query = term.trim();
  const isLink = query.includes('/');

  const list = useQuery({
    queryKey: ['twitch', 'streamers'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/twitch/streamers', { signal });
      if (!res.ok) throw new Error('Failed to load streamers');
      return (await res.json()) as StreamerList;
    },
  });
  const subscribed = new Set(list.data?.subscriptions.map(({ streamer }) => streamer.login));

  const search = useQuery({
    queryKey: ['twitch', 'search', query],
    queryFn: async ({ signal }) => {
      // A short pause: this is a Helix call per keystroke otherwise.
      await new Promise((resolve) => setTimeout(resolve, 300));
      signal.throwIfAborted();
      const res = await fetch(`/api/twitch/search?q=${encodeURIComponent(query)}`, { signal });
      if (!res.ok) throw new Error('Search failed');
      return (await res.json()) as { results: ChannelResult[] };
    },
    enabled: query.length >= 2 && !isLink,
    staleTime: 60_000,
  });
  const results = query.length >= 2 && !isLink ? search.data?.results ?? [] : [];

  const subscribe = useMutation({
    mutationFn: async (target: string) => {
      const res = await fetch('/api/twitch/streamers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: target }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not subscribe');
    },
    onSuccess: () => {
      if (isLink) setTerm('');
      toast.success('Subscribed');
      void queryClient.invalidateQueries({ queryKey: ['twitch'] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="animate-content-in">
      <PageHeader title="Add streamer" backHref="/twitch/streamers" />
      <div className="space-y-3 pt-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <SearchInput
            clearable
            autoFocus
            value={term}
            onChange={setTerm}
            historyKey="twitch-streamers"
            placeholder="Twitch name or channel link"
            aria-label="Twitch name or channel link"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="pl-9"
          />
        </div>

        {isLink ? (
          <div className="overflow-hidden rounded-xl bg-card">
            <button
              type="button"
              disabled={subscribe.isPending}
              onClick={() => subscribe.mutate(query)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-foreground/5"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Link2 className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Subscribe to this channel</span>
                <span className="block truncate text-[11px] text-muted-foreground">{query}</span>
              </span>
              {subscribe.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Plus className="h-4 w-4 text-primary" />}
            </button>
          </div>
        ) : results.length > 0 ? (
          <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card">
            {results.map((channel) => {
              const added = subscribed.has(channel.login);
              const pending = subscribe.isPending && subscribe.variables === channel.login;
              return (
                <button
                  key={channel.twitchUserId}
                  type="button"
                  disabled={added || subscribe.isPending}
                  onClick={() => subscribe.mutate(channel.login)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-foreground/5"
                >
                  <StreamerAvatar url={channel.profileImageUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{channel.displayName}</span>
                    <span className={`block truncate text-[11px] ${channel.isLive ? 'text-red-400' : 'text-muted-foreground'}`}>
                      {channel.isLive ? `Live${channel.category ? ` · ${channel.category}` : ''}` : channel.category ?? `@${channel.login}`}
                    </span>
                  </span>
                  {added
                    ? <Check aria-label="Subscribed" className="h-4 w-4 text-green-500" />
                    : pending
                      ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      : <Plus className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
        ) : query.length >= 2 && search.isFetching ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : query.length >= 2 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No channels for “{query}”</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl bg-card">
              <button type="button" onClick={() => setImportOpen(true)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-foreground/5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><UserPlus className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Import who you follow</span>
                  <span className="block truncate text-[11px] text-muted-foreground">Pick from your Twitch follow list</span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <Search className="h-6 w-6 opacity-50" />
              <p className="text-sm">Search for a streamer, or paste a channel link</p>
            </div>
          </>
        )}
      </div>
      <ImportFollows open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
