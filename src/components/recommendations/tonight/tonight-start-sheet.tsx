'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Users } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { jsonFetcher } from '@/lib/query-fetch';
import { RANDOM_RUNTIME_LABELS } from '@/lib/random-watch-filters';
import type { TonightFilters, TonightMember } from '@/types/tonight';

function filterSummary(filters: TonightFilters): string {
  const kind = filters.type === 'movie' ? 'Movies' : filters.type === 'series' ? 'Series' : 'Movies and series';
  const parts = [kind];
  if (filters.watch === 'unwatched') parts.push('Unwatched');
  // The length is for movies only: said so beside series, and left out with series alone.
  if (filters.runtime && filters.runtime !== 'any' && filters.type !== 'series') {
    const length = RANDOM_RUNTIME_LABELS[filters.runtime];
    parts.push(filters.type === 'movie' ? length : `${length} (movies)`);
  }
  const genres = filters.genres ?? [];
  if (genres.length > 0) parts.push(genres.length > 2 ? `${genres.slice(0, 2).join(', ')} +${genres.length - 2}` : genres.join(', '));
  return parts.join(' · ');
}

/** Pick who to invite to a Tonight pick, using the Random filters already set. */
export function TonightStartSheet({
  open,
  onOpenChange,
  filters,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: TonightFilters;
  onStarted: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ['tonight-members'],
    queryFn: jsonFetcher<{ members: TonightMember[] }>('/api/tonight/members'),
    enabled: open,
    staleTime: 60_000,
  });
  const members = membersQuery.data?.members ?? [];

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/tonight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...filters, inviteeIds: selected }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        setError(data?.error ?? 'Could not start the pick');
        return;
      }
      setSelected([]);
      onStarted(data.id);
    } catch {
      setError('Could not start the pick');
    } finally {
      setStarting(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Pick together</DrawerTitle>
          <DrawerDescription>
            {filterSummary(filters)}. Everyone swipes on the same 20 titles, and the first one you all say yes to wins.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {membersQuery.isPending ? (
            <div className="py-10 text-center text-muted-foreground">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            </div>
          ) : membersQuery.isError ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load your household.</p>
          ) : members.length === 0 ? (
            <div className="space-y-1 py-10 text-center text-muted-foreground">
              <Users className="mx-auto h-8 w-8 opacity-50" />
              <p className="text-sm">No one else here can use Random yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card">
              {members.map((m) => (
                <li key={m.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2.5">
                    <Checkbox checked={selected.includes(m.id)} onCheckedChange={() => toggle(m.id)} aria-label={`Invite ${m.name}`} />
                    <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
        </div>
        <DrawerFooter>
          <Button size="lg" className="h-11" disabled={selected.length === 0 || starting} onClick={() => void start()}>
            {starting && <Loader2 className="h-4 w-4 animate-spin" />}
            {selected.length === 0 ? 'Choose who to invite' : `Start and invite ${selected.length}`}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
