'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';

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
export function ImportFollows({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
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

  const available = (follows.data?.follows ?? []).filter((follow) => !follow.subscribed);
  const connected = follows.data?.connected;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Import who you follow</DrawerTitle>
          <DrawerDescription>
            {connected ? `${picked.size} of ${available.length} chosen` : 'Helprr only reads your follow list.'}
          </DrawerDescription>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          {follows.isLoading && (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          )}
          {follows.isError && <p className="py-8 text-center text-sm text-muted-foreground">Could not load your follows.</p>}
          {device && (
            <div className="space-y-2 py-4 text-center">
              <p className="text-sm text-muted-foreground">Enter this code at Twitch</p>
              <p className="text-2xl font-semibold tracking-widest tabular-nums">{device.userCode}</p>
              <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Waiting for you</p>
            </div>
          )}
          {connected && available.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">You already subscribe to everyone you follow.</p>
          )}
          {connected && available.length > 0 && (
            <div className="grouped-section-content overflow-hidden">
              {available.map((follow) => (
                <label key={follow.twitchUserId} className="grouped-row cursor-pointer gap-3 active:bg-foreground/5">
                  <span className="min-w-0 flex-1 truncate text-sm">{follow.displayName}</span>
                  <Checkbox
                    aria-label={`Choose ${follow.displayName}`}
                    checked={picked.has(follow.twitchUserId)}
                    onCheckedChange={(checked) => setPicked((prev) => {
                      const next = new Set(prev);
                      if (checked === true) next.add(follow.twitchUserId);
                      else next.delete(follow.twitchUserId);
                      return next;
                    })}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        <DrawerFooter>
          {follows.data && !connected && !device && (
            <Button className="w-full" disabled={start.isPending} onClick={() => start.mutate()}>Sign in to Twitch</Button>
          )}
          {device && (
            <Button asChild variant="outline" className="w-full">
              <a href={device.verificationUri} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open Twitch</a>
            </Button>
          )}
          {connected && available.length > 0 && (
            <>
              <Button className="w-full" disabled={picked.size === 0 || subscribe.isPending} onClick={() => subscribe.mutate()}>
                {subscribe.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Subscribe to ${picked.size}`}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setPicked(new Set(available.map((follow) => follow.twitchUserId)))}>
                Select all
              </Button>
            </>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
