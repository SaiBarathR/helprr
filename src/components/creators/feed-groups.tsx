'use client';

import { ChevronRight } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import Link from '@/components/ui/app-link';
import { Skeleton } from '@/components/ui/skeleton';
import { CreatorAvatar } from './creator-avatar';
import { useCreatorPlatform } from './platform';
import type { CreatorVideoItem } from './types';
import type { VideoActions } from './use-video-actions';
import type { useVideoSelection } from './use-video-selection';
import { CreatorVideoCard } from './video-card';

export interface FeedGroup {
  creator: { id: string; login: string; displayName: string; profileImageUrl: string | null };
  /** Every video of this creator that matches the filters, not only the ones sent. */
  total: number;
  newCount: number;
  videos: CreatorVideoItem[];
}

export interface FeedGroupPage {
  groups: FeedGroup[];
  total: number;
  videoTotal: number;
  page: number;
  pageSize: number;
  categories?: string[];
}

/** Keeps the progress bars moving while something downloads, then stops by itself. */
export const whileGroupsDownloading = (query: { state: { data?: { pages: FeedGroupPage[] } } }) => (
  query.state.data?.pages.some((page) => page.groups.some((group) => group.videos.some((video) => video.activeJob))) ? 5_000 : false
);

// The thumbnail's height at each card width, so See all lines up with the pictures.
const CARD = 'w-[160px] sm:w-[200px] lg:w-[220px]';
const THUMB_HEIGHT = 'h-[90px] sm:h-[112px] lg:h-[124px]';

/** One row per creator, newest first, each swiping through its newest videos. */
export function FeedGroups({ groups, actions, selection }: {
  groups: FeedGroup[];
  actions: VideoActions;
  selection: ReturnType<typeof useVideoSelection>;
}) {
  const platform = useCreatorPlatform();
  return (
    <div className="space-y-5">
      {groups.map(({ creator, total, newCount, videos }) => {
        const href = `${platform.creatorsPath}/${creator.id}`;
        const latest = videos[0] && formatDistanceToNowStrict(new Date(videos[0].sourceCreatedAt), { addSuffix: true });
        return (
          <section key={creator.id} aria-label={creator.displayName}>
            <Link href={href} className="press-feedback mb-2 flex min-h-11 items-center gap-2.5">
              <CreatorAvatar url={creator.profileImageUrl} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold leading-tight">{creator.displayName}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {newCount > 0 && <><span className="font-semibold text-primary">{newCount} new</span>{' · '}</>}
                  latest {latest}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
            {/* Snapping aligns to the padding, not the screen edge, so the first card lines up with the name. */}
            <div className="-mx-2 flex snap-x scroll-px-2 gap-2.5 overflow-x-auto px-2 pb-1 scrollbar-hide md:-mx-6 md:scroll-px-6 md:gap-3.5 md:px-6">
              {videos.map((video) => (
                <div key={video.id} className={`${CARD} shrink-0 snap-start`}>
                  <CreatorVideoCard
                    video={video}
                    layout="grid"
                    showStreamer={false}
                    actions={actions}
                    selection={selection.selectionFor(video)}
                    onSelect={selection.startWith(video)}
                  />
                </div>
              ))}
              <Link
                href={href}
                className={`press-feedback flex w-[104px] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-xl bg-card text-center text-xs ${THUMB_HEIGHT}`}
              >
                <ChevronRight className="h-4 w-4 text-primary" />
                See all
                <span className="text-[11px] text-muted-foreground">{total} {total === 1 ? 'video' : 'videos'}</span>
              </Link>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function FeedGroupsSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading videos" className="space-y-5">
      {Array.from({ length: 3 }, (_, group) => (
        <div key={group} aria-hidden="true">
          <div className="mb-2 flex min-h-11 items-center gap-2.5">
            <Skeleton className="h-[30px] w-[30px] rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          </div>
          <div className="flex gap-2.5 overflow-hidden">
            {Array.from({ length: 4 }, (_, card) => (
              <div key={card} className={`${CARD} shrink-0 space-y-1.5`}>
                <Skeleton className="aspect-video w-full rounded-xl" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
