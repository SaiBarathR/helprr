'use client';

import { use, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { FadeInImage } from '@/components/media/fade-in-image';
import { Button } from '@/components/ui/button';
import { useMe, hasCapability } from '@/components/permission-provider';
import { StreamerRules } from '@/components/twitch/streamer-rules';
import { TwitchVideoCard } from '@/components/twitch/twitch-video-card';
import type { TwitchVideoPage } from '@/components/twitch/types';
import { useRestorableInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { toCachedImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'ARCHIVE', label: 'Videos' },
  { id: 'HIGHLIGHT', label: 'Highlights' },
  { id: 'UPLOAD', label: 'Uploads' },
  { id: 'RULES', label: 'Rules' },
] as const;

interface Streamer {
  id: string;
  displayName: string;
  description: string | null;
  profileImageUrl: string | null;
  offlineImageUrl: string | null;
  isLive: boolean;
  liveTitle: string | null;
  liveCategory: string | null;
}

export default function TwitchStreamerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const tabs = TABS.filter((item) => item.id !== 'RULES' || hasCapability(me, 'twitch.manage'));
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('ARCHIVE');

  const streamerQuery = useQuery({
    queryKey: ['twitch', 'streamer', id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/twitch/streamers/${id}`, { signal });
      if (!res.ok) throw new Error('Failed to load streamer');
      return (await res.json()) as Streamer;
    },
  });
  const streamer = streamerQuery.data;

  const videos = useRestorableInfiniteQuery({
    queryKey: ['twitch', 'streamer-videos', id, tab],
    enabled: tab !== 'RULES',
    queryFn: async ({ pageParam, signal }) => {
      const res = await fetch(`/api/twitch/streamers/${id}/videos?type=${tab}&page=${pageParam}`, { signal });
      if (!res.ok) throw new Error('Failed to load videos');
      return (await res.json()) as TwitchVideoPage;
    },
    initialPageParam: 1,
    getNextPageParam: (last: TwitchVideoPage) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const rows = useMemo(() => videos.data?.pages.flatMap((page) => page.videos) ?? [], [videos.data]);

  const banner = toCachedImageSrc(streamer?.offlineImageUrl, undefined, { width: 1200 });
  const avatar = toCachedImageSrc(streamer?.profileImageUrl, undefined, { width: 144 });

  return (
    <div className="animate-content-in pb-8">
      <PageHeader title={streamer?.displayName ?? 'Streamer'} backHref="/twitch/streamers" />
      <div className="relative h-32 overflow-hidden bg-muted sm:h-44">
        {banner && <FadeInImage src={banner} alt="" fill sizes="100vw" className="object-cover" unoptimized />}
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
      </div>
      <div className="relative -mt-8 space-y-4 px-4">
        <div className="flex items-end gap-3">
          <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-full bg-muted ring-2 ring-background">
            {avatar && <FadeInImage src={avatar} alt="" fill sizes="64px" className="object-cover" unoptimized />}
          </span>
          {streamer?.isLive && (
            <span className="flex min-w-0 items-center gap-1 pb-1 text-xs text-red-400">
              <Radio className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{streamer.liveTitle || 'Live'}{streamer.liveCategory ? ` · ${streamer.liveCategory}` : ''}</span>
            </span>
          )}
        </div>
        {streamer?.description && <p className="text-sm text-muted-foreground">{streamer.description}</p>}

        <div role="tablist" aria-label="Video types" className="grid grid-flow-col auto-cols-fr gap-1 rounded-md bg-muted/40 p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn('min-h-9 rounded text-sm font-medium', tab === item.id ? 'bg-background shadow-sm' : 'text-muted-foreground')}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'RULES' && <StreamerRules streamerId={id} />}
        {tab !== 'RULES' && videos.isSuccess && rows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No videos here.</p>
        )}
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((video) => <TwitchVideoCard key={video.id} video={video} layout="grid" showStreamer={false} />)}
        </div>
        {videos.hasNextPage && (
          <Button variant="outline" className="w-full" disabled={videos.isFetchingNextPage} onClick={() => void videos.fetchNextPage()}>
            {videos.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </div>
    </div>
  );
}
