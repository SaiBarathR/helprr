'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Loader2, Radio, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { PageHeader } from '@/components/layout/page-header';
import { FadeInImage } from '@/components/media/fade-in-image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ImportFollows } from '@/components/twitch/import-follows';
import { TwitchSubNav } from '@/components/twitch/twitch-subnav';
import { toCachedImageSrc } from '@/lib/image';

interface Subscription {
  id: string;
  notifyNewVods: boolean;
  streamer: {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
    isLive: boolean;
    liveTitle: string | null;
  };
}

const QUERY_KEY = ['twitch', 'streamers'];

export default function TwitchStreamersPage() {
  const queryClient = useQueryClient();
  const [login, setLogin] = useState('');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['twitch'] });

  const list = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/twitch/streamers', { signal });
      if (!res.ok) throw new Error('Failed to load streamers');
      return (await res.json()) as { subscriptions: Subscription[] };
    },
  });

  const subscribe = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/twitch/streamers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not subscribe');
    },
    onSuccess: () => {
      setLogin('');
      toast.success('Subscribed');
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleNotify = useMutation({
    mutationFn: async ({ id, notifyNewVods }: { id: string; notifyNewVods: boolean }) => {
      const res = await fetch(`/api/twitch/subscriptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyNewVods }),
      });
      if (!res.ok) throw new Error('Could not change notifications');
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  const unsubscribe = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/twitch/subscriptions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not unsubscribe');
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  const subscriptions = list.data?.subscriptions ?? [];

  return (
    <div className="animate-content-in pb-8">
      <PageHeader title="Streamers" showBack={false} rightContent={<TwitchSubNav active="streamers" />} />
      <div className="space-y-4 px-4 pt-2">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (login.trim()) subscribe.mutate();
          }}
        >
          <Input
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            placeholder="Twitch name or channel link"
            aria-label="Twitch name or channel link"
            autoCapitalize="none"
            autoCorrect="off"
            className="h-10"
          />
          <Button type="submit" className="h-10 shrink-0" disabled={!login.trim() || subscribe.isPending}>
            {subscribe.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Subscribe'}
          </Button>
        </form>

        <ImportFollows />

        {list.isError && <p className="py-8 text-center text-sm text-muted-foreground">Could not load your streamers.</p>}
        {list.isSuccess && subscriptions.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No streamers yet. Add one above.</p>
        )}

        {subscriptions.length > 0 && (
          <div className="grouped-section-content">
            {subscriptions.map(({ id, notifyNewVods, streamer }) => {
              const avatar = toCachedImageSrc(streamer.profileImageUrl, undefined, { width: 80 });
              return (
                <div key={id} className="grouped-row">
                  <Link href={`/twitch/streamers/${streamer.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="relative block h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted">
                      {avatar && <FadeInImage src={avatar} alt="" fill sizes="36px" className="object-cover" unoptimized />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{streamer.displayName}</span>
                      {streamer.isLive && (
                        <span className="flex items-center gap-1 truncate text-xs text-red-400">
                          <Radio className="h-3 w-3 shrink-0" />
                          <span className="truncate">{streamer.liveTitle || 'Live'}</span>
                        </span>
                      )}
                    </span>
                  </Link>
                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11"
                      aria-label={notifyNewVods ? `Turn off notifications for ${streamer.displayName}` : `Turn on notifications for ${streamer.displayName}`}
                      onClick={() => toggleNotify.mutate({ id, notifyNewVods: !notifyNewVods })}
                    >
                      {notifyNewVods ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11"
                      aria-label={`Unsubscribe from ${streamer.displayName}`}
                      onClick={() => unsubscribe.mutate(id)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
