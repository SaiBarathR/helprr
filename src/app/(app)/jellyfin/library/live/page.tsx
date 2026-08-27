'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { WatchSubNav } from '@/components/jellyfin-streaming/watch-subnav';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { jellyfinPosterUrl } from '@/lib/jellyfin-playback/image';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { FadeInImage } from '@/components/media/fade-in-image';
import type { LiveTvResponse } from '@/types/jellyfin-streaming';
import type { JellyfinItem } from '@/types/jellyfin';

function formatGuideTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function programsForChannel(programs: JellyfinItem[], channelId: string): JellyfinItem[] {
  const now = Date.now();
  return programs
    .filter((program) => program.ChannelId === channelId)
    .sort((left, right) => new Date(left.StartDate || 0).getTime() - new Date(right.StartDate || 0).getTime())
    .filter((program) => {
      const end = program.EndDate ? new Date(program.EndDate).getTime() : 0;
      return !end || end >= now - 30 * 60_000;
    })
    .slice(0, 3);
}

export default function LiveTvPage() {
  const playback = useJellyfinPlayback();
  const query = useQuery({
    queryKey: queryKeys.jellyfinLive(),
    queryFn: jsonFetcher<LiveTvResponse>('/api/jellyfin/catalog/live'),
  });

  const programByChannel = useMemo(() => {
    const map = new Map<string, JellyfinItem[]>();
    for (const program of query.data?.programs ?? []) {
      const channelId = program.ChannelId;
      if (!channelId) continue;
      const list = map.get(channelId) ?? [];
      list.push(program);
      map.set(channelId, list);
    }
    return map;
  }, [query.data?.programs]);

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) return <ErrorState message="Couldn't load Live TV." onRetry={() => void query.refetch()} />;

  const channels = query.data?.channels ?? [];
  const recordings = query.data?.recordings ?? [];

  return (
    <div className="space-y-6 p-4 pb-28">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Live TV</h1>
          <p className="text-xs text-muted-foreground">{channels.length} channels</p>
        </div>
        <WatchSubNav />
      </div>
      {channels.length === 0 && (
        <p className="text-sm text-muted-foreground">No Live TV tuners are configured on this Jellyfin server.</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {channels.map((channel) => {
          const guide = programsForChannel(programByChannel.get(channel.Id) ?? [], channel.Id);
          const now = guide[0];
          const next = guide[1];
          const nowName = channel.CurrentProgram?.Name || now?.Name;
          const nowStart = channel.CurrentProgram?.StartDate || now?.StartDate;
          return (
            <button
              key={channel.Id}
              type="button"
              onClick={() => void playback.playItem(channel)}
              className="flex items-center gap-3 rounded-lg border bg-card p-2 text-left hover:bg-accent"
            >
              <div className="relative size-14 shrink-0 overflow-hidden rounded bg-muted">
                {jellyfinPosterUrl(channel, 120) && (
                  <FadeInImage src={jellyfinPosterUrl(channel, 120)!} alt="" fill sizes="56px" unoptimized className="object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{channel.Name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {nowName ? `${formatGuideTime(nowStart)} ${nowName}` : 'Live channel'}
                </p>
                {next?.Name && (
                  <p className="truncate text-[11px] text-muted-foreground">
                    Next {formatGuideTime(next.StartDate)} · {next.Name}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {recordings.length > 0 && (
        <CatalogRail title="Recordings" items={recordings} onPlay={(item) => void playback.playItem(item)} />
      )}
    </div>
  );
}
