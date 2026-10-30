'use client';

import { use, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Tv } from 'lucide-react';
import { format } from 'date-fns';
import Link from '@/components/ui/app-link';
import { PageHeader } from '@/components/layout/page-header';
import { FadeInImage } from '@/components/media/fade-in-image';
import { daysUntil, formatDuration, VIDEO_TYPE_LABELS, type TwitchVideo } from '@/components/twitch/types';
import { toCachedImageSrc } from '@/lib/image';

function mutedTotal(video: TwitchVideo): number {
  return (video.mutedSegments ?? []).reduce((total, segment) => total + segment.duration, 0);
}

export default function TwitchVodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['twitch', 'video', id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/twitch/videos/${id}`, { signal });
      if (!res.ok) throw new Error('Failed to load video');
      return (await res.json()) as TwitchVideo;
    },
  });
  const video = query.data;

  const unseen = video && !video.seen;
  useEffect(() => {
    if (!unseen) return;
    void fetch(`/api/twitch/videos/${id}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seen: true }),
    }).then(() => queryClient.invalidateQueries({ queryKey: ['twitch', 'feed'] }));
  }, [id, unseen, queryClient]);

  if (query.isError) {
    return <p className="py-16 text-center text-sm text-muted-foreground">This video could not be loaded.</p>;
  }
  if (!video) return null;

  const thumbnail = toCachedImageSrc(video.thumbnailUrl, undefined, { width: 1200 });
  const expiresIn = daysUntil(video.estimatedExpiresAt);
  const muted = mutedTotal(video);

  return (
    <div className="animate-content-in pb-8">
      <PageHeader title={video.streamer.displayName} backHref="/twitch" />
      <div className="relative aspect-video max-h-[50vh] w-full overflow-hidden bg-muted">
        {thumbnail ? (
          <FadeInImage src={thumbnail} alt="" fill sizes="100vw" className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground"><Tv className="h-10 w-10" /></div>
        )}
      </div>
      <div className="space-y-3 px-4 pt-3">
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {video.availability === 'RECORDING' ? 'Recording' : VIDEO_TYPE_LABELS[video.type]} · {formatDuration(video.durationSeconds)}
        </p>
        <h1 className="text-lg font-semibold leading-snug">{video.title}</h1>
        <p className="text-sm text-muted-foreground">
          <Link href={`/twitch/streamers/${video.streamer.id}`} className="underline-offset-2 hover:underline">{video.streamer.displayName}</Link>
          {' · '}{format(new Date(video.twitchCreatedAt), 'PP')}
        </p>
        {expiresIn !== null && expiresIn >= 0 && (
          <p className="text-sm text-muted-foreground">Estimated to expire in {expiresIn} {expiresIn === 1 ? 'day' : 'days'}.</p>
        )}
        {muted > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Twitch muted {formatDuration(muted)} of this video&apos;s audio. It cannot be recovered.</span>
          </p>
        )}
        {video.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{video.description}</p>}
      </div>
    </div>
  );
}
