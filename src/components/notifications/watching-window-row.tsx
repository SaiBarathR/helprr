'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { WATCHING_EPISODE_DAYS_DEFAULT, WATCHING_EPISODE_DAY_OPTIONS } from '@/lib/notification-events';

const TRIGGER_CLASS =
  'w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5';

interface WatchingSettings {
  watchingEpisodeDays: number;
  jellyfinLinked: boolean;
}

const QUERY_KEY = ['me-watching-settings'] as const;

/**
 * The account-wide window for "New Episodes of Your Shows": which shows count
 * as ones you're watching. Off stops the alert for every device and the
 * in-app list; the switch above only mutes this device.
 */
export function WatchingWindowRow() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: jsonFetcher<WatchingSettings>('/api/me/settings'),
  });

  const save = useMutation({
    // Same scope as the other /api/me/settings writes, so they apply in order.
    scope: { id: 'me-settings' },
    mutationFn: async (watchingEpisodeDays: number) => {
      const res = await fetch('/api/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchingEpisodeDays }),
      });
      if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
    },
    onMutate: async (watchingEpisodeDays) => {
      // A refetch landing after this would put the old value back.
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<WatchingSettings>(QUERY_KEY);
      if (previous) queryClient.setQueryData<WatchingSettings>(QUERY_KEY, { ...previous, watchingEpisodeDays });
      return { previous };
    },
    onError: (_err, _days, context) => {
      toast.error('Failed to save');
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
  });

  if (data && !data.jellyfinLinked) {
    return (
      // Its own row, where the days picker goes once linked (a note pulled up
      // under the switch sat on the divider between them).
      <p className="grouped-row text-xs text-muted-foreground">
        <span>
          Needs your Jellyfin account.{' '}
          <Link href="/settings/account" className="text-primary">Link it in Account</Link>
        </span>
      </p>
    );
  }

  return (
    <div className="grouped-row">
      <span className="text-sm">Shows you played in the last</span>
      <Select
        value={String(data?.watchingEpisodeDays ?? WATCHING_EPISODE_DAYS_DEFAULT)}
        onValueChange={(v) => save.mutate(parseInt(v, 10))}
        disabled={!data}
      >
        <SelectTrigger aria-label="Shows you played in the last" className={TRIGGER_CLASS}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WATCHING_EPISODE_DAY_OPTIONS.map((days) => (
            <SelectItem key={days} value={String(days)}>
              {days === 0 ? 'Off (all devices)' : `${days} days`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
