'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Link2, Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/media/search-input';
import { CreatorAvatar } from '@/components/creators/creator-avatar';
import { isChannelId, parsePlaylistLink } from '@/lib/youtube/ids';

interface ChannelResult {
  channelId: string;
  title: string;
  handle: string | null;
  avatarUrl: string | null;
}

interface ChannelList {
  subscriptions: Array<{ creator: { externalId: string } }>;
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || fallback);
  return data as T;
}

// Text fields live on a page, not in a drawer: the iOS keyboard pushes a drawer out of view.
export default function AddChannelPage() {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [searched, setSearched] = useState('');
  const query = term.trim();
  // A pasted handle or link needs no search, and Google allows 100 searches a day.
  const direct = query.startsWith('@') || query.includes('/') || isChannelId(query);
  const listLink = direct && parsePlaylistLink(query) !== null;

  const list = useQuery({
    queryKey: ['youtube', 'creators'],
    queryFn: async ({ signal }) => readJson<ChannelList>(await fetch('/api/youtube/channels', { signal }), 'Could not load'),
  });
  const followed = new Set(list.data?.subscriptions.map(({ creator }) => creator.externalId));

  const search = useQuery({
    queryKey: ['youtube', 'search', searched],
    queryFn: async ({ signal }) => readJson<{ results: ChannelResult[] }>(
      await fetch(`/api/youtube/search?q=${encodeURIComponent(searched)}`, { signal }),
      'Search failed',
    ),
    enabled: searched.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const showResults = searched === query && searched.length >= 2;
  const results = showResults ? search.data?.results ?? [] : [];

  const follow = useMutation({
    mutationFn: async (input: string) => readJson(await fetch(listLink ? '/api/youtube/playlists' : '/api/youtube/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    }), 'Could not follow this'),
    onSuccess: () => {
      if (direct) setTerm('');
      toast.success('Following');
      void queryClient.invalidateQueries({ queryKey: ['youtube'] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="animate-content-in">
      <PageHeader title="Add channel" backHref="/youtube/channels" />
      <div className="space-y-3 pt-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <SearchInput
            clearable
            autoFocus
            value={term}
            onChange={setTerm}
            historyKey="youtube-channels"
            placeholder="@handle, link or name"
            aria-label="@handle, link or name"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="pl-9"
          />
        </div>

        {direct ? (
          <div className="overflow-hidden rounded-xl bg-card">
            <button
              type="button"
              disabled={follow.isPending}
              onClick={() => follow.mutate(query)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-foreground/5"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Link2 className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{listLink ? 'Follow this playlist' : 'Follow this channel'}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{query}</span>
              </span>
              {follow.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Plus className="h-4 w-4 text-primary" />}
            </button>
          </div>
        ) : query.length >= 2 && !showResults ? (
          <div className="overflow-hidden rounded-xl bg-card">
            <button
              type="button"
              onClick={() => setSearched(query)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-foreground/5"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Search className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Search YouTube</span>
                <span className="block truncate text-[11px] text-muted-foreground">{query}</span>
              </span>
            </button>
          </div>
        ) : results.length > 0 ? (
          <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card">
            {results.map((channel) => {
              const added = followed.has(channel.channelId);
              const pending = follow.isPending && follow.variables === channel.channelId;
              return (
                <button
                  key={channel.channelId}
                  type="button"
                  disabled={added || follow.isPending}
                  onClick={() => follow.mutate(channel.channelId)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-foreground/5"
                >
                  <CreatorAvatar url={channel.avatarUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{channel.title}</span>
                    {channel.handle && <span className="block truncate text-[11px] text-muted-foreground">{channel.handle}</span>}
                  </span>
                  {added
                    ? <Check aria-label="Following" className="h-4 w-4 text-green-500" />
                    : pending
                      ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      : <Plus className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
        ) : showResults && search.isFetching ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : showResults && search.isError ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">{search.error.message}</p>
        ) : showResults ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No channels for “{query}”</p>
        ) : (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Search className="h-6 w-6 opacity-50" />
            <p className="text-sm">Paste a channel or playlist link, an @handle, or search by name</p>
          </div>
        )}
      </div>
    </div>
  );
}
