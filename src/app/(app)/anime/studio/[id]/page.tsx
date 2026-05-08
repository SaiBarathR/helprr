'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Badge } from '@/components/ui/badge';
import { Heart, Loader2, Star, ChevronDown } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type {
  AniListStudioDetailResponse,
  AniListStudioMediaNode,
  AniListPageInfo,
} from '@/types/anilist';

const SORT_OPTIONS = [
  { value: 'START_DATE_DESC', label: 'Newest' },
  { value: 'POPULARITY_DESC', label: 'Popularity' },
  { value: 'SCORE_DESC', label: 'Average Score' },
  { value: 'FAVOURITES_DESC', label: 'Favourites' },
  { value: 'START_DATE', label: 'Oldest' },
  { value: 'TITLE_ROMAJI', label: 'Title' },
];

function formatFavourites(n: number | null): string {
  if (n == null) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
}

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

  const [detail, setDetail] = useState<AniListStudioDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Media state
  const [media, setMedia] = useState<AniListStudioMediaNode[]>([]);
  const [pageInfo, setPageInfo] = useState<AniListPageInfo | null>(null);
  const [sort, setSort] = useState('START_DATE_DESC');
  const [loadingMore, setLoadingMore] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  // Load on id or sort change (covers initial load + every sort flip)
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    fetch(`/api/anime/studio/${id}?page=1&sort=${sort}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load');
        return res.json();
      })
      .then((data: AniListStudioDetailResponse) => {
        if (controller.signal.aborted) return;
        setDetail(data);
        setMedia(data.media);
        setPageInfo(data.mediaPageInfo);
        setLoading(false);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e.message);
        setLoading(false);
      });

    return () => controller.abort();
  }, [id, sort]);

  // Fetch more
  const fetchMore = useCallback(async () => {
    if (!pageInfo?.hasNextPage || loadingMore) return;
    setLoadingMore(true);
    try {
      const nextPage = (pageInfo.currentPage || 1) + 1;
      const res = await fetch(`/api/anime/studio/${id}?page=${nextPage}&sort=${sort}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data: AniListStudioDetailResponse = await res.json();
      setMedia((prev) => [...prev, ...data.media]);
      setPageInfo(data.mediaPageInfo);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMore(false);
    }
  }, [id, pageInfo, loadingMore, sort]);

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && pageInfo?.hasNextPage && !loadingMore && !loading) {
          fetchMore();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [pageInfo, loadingMore, loading, fetchMore]);

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
    return <><PageHeader className="-mx-2 md:-mx-6" title="Studio" /><PageSpinner /></>;
  }

  if (error || !detail) {
    return (
      <div>
        <PageHeader className="-mx-2 md:-mx-6" title="Error" />
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
      <PageHeader className="-mx-2 md:-mx-6" title={detail.name} />

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
            <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-xl z-50 py-1 min-w-[140px]">
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
      {loading ? (
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
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
        {item.averageScore != null && item.averageScore > 0 && (
          <Badge className="absolute top-1 right-1 text-[9px] bg-black/60 text-white gap-0.5">
            <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
            {item.averageScore}%
          </Badge>
        )}
        {item.format && (
          <Badge className="absolute bottom-1 left-1 text-[9px] bg-black/60 text-white">
            {item.format.replace(/_/g, ' ')}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-xs font-medium leading-tight line-clamp-2">{item.title}</p>
    </Link>
  );
}
