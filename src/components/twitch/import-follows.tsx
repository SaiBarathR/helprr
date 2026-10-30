'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface Follow {
  twitchUserId: string;
  login: string;
  displayName: string;
  subscribed: boolean;
}

interface DeviceCode {
  userCode: string;
  verificationUri: string;
  interval: number;
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data as T;
}

/** Only ever adds: an existing subscription is not removed by not picking it here. */
export function ImportFollows() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  const follows = useQuery({
    queryKey: ['twitch', 'follows'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/twitch/follows', { signal });
      if (!res.ok) throw new Error('Could not load your follows');
      return (await res.json()) as { connected: boolean; follows: Follow[] };
    },
    enabled: open,
  });

  const start = useMutation({
    mutationFn: () => post<DeviceCode>('/api/twitch/follows/device'),
    onSuccess: setDevice,
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!device) return;
    const timer = setInterval(() => {
      void post<{ status: string }>('/api/twitch/follows/poll').then(({ status }) => {
        if (status === 'pending') return;
        setDevice(null);
        if (status === 'connected') void queryClient.invalidateQueries({ queryKey: ['twitch', 'follows'] });
        else toast.error('That code expired. Start again.');
      }).catch(() => undefined);
    }, Math.max(device.interval, 2) * 1000);
    return () => clearInterval(timer);
  }, [device, queryClient]);

  const subscribe = useMutation({
    mutationFn: async () => {
      const chosen = (follows.data?.follows ?? []).filter((follow) => picked.has(follow.twitchUserId));
      let failed = 0;
      // One at a time: each takes a baseline sweep from Twitch.
      for (const follow of chosen) {
        const res = await fetch('/api/twitch/streamers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: follow.login }),
        }).catch(() => null);
        if (!res?.ok) failed += 1;
      }
      return { added: chosen.length - failed, failed };
    },
    onSuccess: ({ added, failed }) => {
      if (failed > 0) toast.error(`${added} added, ${failed} could not be added`);
      else toast.success(`${added} added`);
      setPicked(new Set());
      void queryClient.invalidateQueries({ queryKey: ['twitch'] });
    },
  });

  if (!open) {
    return (
      <Button variant="outline" className="h-10 w-full" onClick={() => setOpen(true)}>
        <UserPlus className="mr-2 h-4 w-4" />Import who you follow
      </Button>
    );
  }

  const available = (follows.data?.follows ?? []).filter((follow) => !follow.subscribed);

  return (
    <section aria-label="Import follows" className="space-y-3 rounded-xl bg-card p-3">
      {follows.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {follows.isError && <p className="text-sm text-muted-foreground">Could not load your follows.</p>}
      {follows.data && !follows.data.connected && !device && (
        <>
          <p className="text-sm text-muted-foreground">Sign in to Twitch to read who you follow. Helprr asks for nothing else.</p>
          <Button className="h-10 w-full" disabled={start.isPending} onClick={() => start.mutate()}>Sign in to Twitch</Button>
        </>
      )}
      {device && (
        <div className="space-y-2 text-center">
          <p className="text-sm text-muted-foreground">Enter this code at Twitch:</p>
          <p className="font-mono text-2xl tracking-widest">{device.userCode}</p>
          <Button asChild variant="outline" className="h-10 w-full">
            <a href={`${device.verificationUri}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open Twitch</a>
          </Button>
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Waiting for you</p>
        </div>
      )}
      {follows.data?.connected && (
        available.length === 0 ? (
          <p className="text-sm text-muted-foreground">You already subscribe to everyone you follow.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{picked.size} of {available.length} chosen</span>
              <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(available.map((follow) => follow.twitchUserId)))}>Select all</Button>
            </div>
            <ul className="max-h-72 overflow-y-auto">
              {available.map((follow) => (
                <li key={follow.twitchUserId}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3">
                    <Checkbox
                      checked={picked.has(follow.twitchUserId)}
                      onCheckedChange={(checked) => setPicked((prev) => {
                        const next = new Set(prev);
                        if (checked === true) next.add(follow.twitchUserId);
                        else next.delete(follow.twitchUserId);
                        return next;
                      })}
                    />
                    <span className="truncate text-sm">{follow.displayName}</span>
                  </label>
                </li>
              ))}
            </ul>
            <Button className="h-10 w-full" disabled={picked.size === 0 || subscribe.isPending} onClick={() => subscribe.mutate()}>
              {subscribe.isPending ? 'Adding…' : `Subscribe to ${picked.size}`}
            </Button>
          </>
        )
      )}
    </section>
  );
}
