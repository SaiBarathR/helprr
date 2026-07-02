'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Badge } from '@/components/ui/badge';
import { Heart, Loader2, Star, ChevronDown } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { formatFavourites } from '@/lib/anilist-helpers';
import type {
  AniListStudioDetailResponse,
  AniListStudioMediaNode,
} from '@/types/anilist';

const SORT_OPTIONS = [
  { value: 'START_DATE_DESC', label: 'Newest' },
  { value: 'POPULARITY_DESC', label: 'Popularity' },
  { value: 'SCORE_DESC', label: 'Average Score' },
  { value: 'FAVOURITES_DESC', label: 'Favourites' },
  { value: 'START_DATE', label: 'Oldest' },
  { value: 'TITLE_ROMAJI', label: 'Title' },
];

function getMediaYear(item: AniListStudioMediaNode): string {
  if (item.status === 'NOT_YET_RELEASED' && !item.seasonYear && !item.startDate?.year) {
    return 'TBA';
  }
  const year = item.seasonYear || item.startDate?.year;
  return year ? String(year) : 'TBA';
}

export default function StudioDetailPage() {
  const params = useParams();
  const id = params.id as string;

  // Media state
  const [sort, setSort] = useState('START_DATE_DESC');
  const [sortOpen, setSortOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error: queryError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['anime', 'studio', id, sort],
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<AniListStudioDetailResponse>(
        `/api/anime/studio/${id}?page=${pageParam}&sort=${sort}`
      )({ signal }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.mediaPageInfo?.hasNextPage ? (lastPage.mediaPageInfo.currentPage || 1) + 1 : undefined,
  });

  const detail = data?.pages[0] ?? null;
  // Initial load (no cached data) OR a sort refetch with nothing yet rendered.
  const loading = isLoading || (isFetching && !isFetchingNextPage && !detail);
  const error = isError ? (queryError instanceof Error ? queryError.message : 'Failed to load') : null;
  const media = useMemo<AniListStudioMediaNode[]>(
    () => data?.pages.flatMap((p) => p.media) ?? [],
    [data]
  );
  const loadingMore = isFetchingNextPage;
  // Reproduce the "spinner on sort flip" the old code showed via setLoading(true).
  const contentLoading = isFetching && !isFetchingNextPage;

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage && !contentLoading) {
          void fetchNextPage();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, contentLoading, fetchNextPage]);

  // Close dropdown
  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sortOpen]);

  if (loading && !detail) {
    return <><PageHeader title="Studio" /><PageSpinner /></>;
  }

  if (error || !detail) {
    return (
      <div>
        <PageHeader title="Error" />
        <div className="p-4 text-center text-muted-foreground">{error || 'Failed to load'}</div>
      </div>
    );
  }

  // Group by year for date-based sorts
  const isDateSort = sort === 'START_DATE_DESC' || sort === 'START_DATE';
  const yearGroups: { year: string; items: AniListStudioMediaNode[] }[] = [];
  if (isDateSort) {
    const groupMap = new Map<string, AniListStudioMediaNode[]>();
    for (const item of media) {
      const year = getMediaYear(item);
      const existing = groupMap.get(year);
      if (existing) {
        existing.push(item);
      } else {
        groupMap.set(year, [item]);
      }
    }
    for (const [year, items] of groupMap) {
      yearGroups.push({ year, items });
    }
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={detail.name} />

      {/* Studio Header */}
      <div className="mt-2">
        <h1 className="text-2xl font-bold">{detail.name}</h1>
        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1.5">
            <Heart className="h-4 w-4 text-red-400 fill-red-400" />
            <span className="text-sm font-semibold">{formatFavourites(detail.favourites)}</span>
          </div>
          {detail.isAnimationStudio && (
            <Badge variant="secondary" className="text-xs">Animation Studio</Badge>
          )}
        </div>
      </div>

      {/* Sort + Controls */}
      <div className="relative z-20 flex items-center justify-end mt-4 mb-3">
        <div className="relative" ref={sortDropdownRef}>
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={() => setSortOpen(!sortOpen)}
          >
            <span>{SORT_OPTIONS.find((o) => o.value === sort)?.label || 'Sort'}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {sortOpen && (
            <div className="app-glass-overlay absolute right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-xl z-50 py-1 min-w-[140px]">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors cursor-pointer ${sort === opt.value ? 'text-primary font-medium' : 'text-foreground'}`}
                  onClick={() => { setSort(opt.value); setSortOpen(false); }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {contentLoading ? (
        <PageSpinner />
      ) : isDateSort ? (
        // Year-grouped layout
        <div className="space-y-6">
          {yearGroups.map((group) => (
            <div key={group.year}>
              <h3 className="text-lg font-bold mb-3 text-foreground">{group.year}</h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {group.items.map((item) => (
                  <StudioMediaCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Flat grid
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
          {media.map((item) => (
            <StudioMediaCard key={item.id} item={item} />
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-4" />
      {loadingMore && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Bottom padding */}
      <div className="h-8" />
    </div>
  );
}

function StudioMediaCard({ item }: { item: AniListStudioMediaNode }) {
  const imgSrc = item.coverImage
    ? toCachedImageSrc(item.coverImage, 'anilist') || item.coverImage
    : null;

  const isManga = item.type === 'MANGA' || item.format === 'MANGA' || item.chapters != null;
  const href = isManga ? `/anime/manga/${item.id}` : `/anime/${item.id}`;

  return (
    <Link href={href} className="group">
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted shadow-sm group-hover:shadow-md transition-shadow border border-border/30 group-hover:border-primary/40">
        {imgSrc ? (
          <Image
            src={imgSrc}
            alt={item.title}
            fill
            sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, 16vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            unoptimized={isProtectedApiImageSrc(imgSrc)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
            {item.title}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/60 to-transparent pointer-events-none" />
        {item.averageScore != null && item.averageScore > 0 && (
          <Badge className="absolute top-1 right-1 text-[9px] bg-background/60 text-foreground gap-0.5">
            <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
            {item.averageScore}%
          </Badge>
        )}
        {item.format && (
          <Badge className="absolute bottom-1 left-1 text-[9px] bg-background/60 text-foreground">
            {item.format.replace(/_/g, ' ')}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-xs font-medium leading-tight line-clamp-2">{item.title}</p>
    </Link>
  );
}
