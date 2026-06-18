'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import DOMPurify from 'isomorphic-dompurify';
import { useInfiniteQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Badge } from '@/components/ui/badge';
import { Heart, Loader2, Star, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { formatFavourites, formatFuzzyDate } from '@/lib/anilist-helpers';
import type {
  AniListCharacterDetailResponse,
  AniListCharacterMediaEdge,
} from '@/types/anilist';

const SORT_OPTIONS = [
  { value: 'POPULARITY_DESC', label: 'Popularity' },
  { value: 'SCORE_DESC', label: 'Average Score' },
  { value: 'FAVOURITES_DESC', label: 'Favourites' },
  { value: 'START_DATE_DESC', label: 'Newest' },
  { value: 'START_DATE', label: 'Oldest' },
  { value: 'TITLE_ROMAJI', label: 'Title' },
];

export default function CharacterDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [descExpanded, setDescExpanded] = useState(false);
  const [spoilerVisible, setSpoilerVisible] = useState(false);
  const [spoilerNamesVisible, setSpoilerNamesVisible] = useState(false);

  // Media state
  const [sort, setSort] = useState('POPULARITY_DESC');
  const [sortOpen, setSortOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  const {
    data,
    isLoading,
    isError,
    error: queryError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['anime', 'character', id, sort],
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<AniListCharacterDetailResponse>(
        `/api/anime/character/${id}?page=${pageParam}&sort=${sort}`
      )({ signal }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.mediaPageInfo?.hasNextPage ? (lastPage.mediaPageInfo.currentPage || 1) + 1 : undefined,
  });

  const detail = data?.pages[0] ?? null;
  // Full-page spinner only while there's nothing to show (first load, or a sort
  // flip to an uncached sort). A background refetch of cached pages keeps them
  // visible instead of blanking to a spinner.
  const loading = isLoading;
  // Keep cached pages visible on a transient refetch failure; only surface the
  // error when nothing has loaded yet.
  const error = !data && isError ? (queryError instanceof Error ? queryError.message : 'Failed to load') : null;
  const media = useMemo<AniListCharacterMediaEdge[]>(
    () => data?.pages.flatMap((p) => p.media) ?? [],
    [data]
  );
  const loadingMore = isFetchingNextPage;

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Close sort dropdown on outside click
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
    return <><PageHeader className="-mx-2 md:-mx-6" title="Character" /><PageSpinner /></>;
  }

  if (error || !detail) {
    return (
      <div>
        <PageHeader className="-mx-2 md:-mx-6" title="Error" />
        <div className="p-4 text-center text-muted-foreground">{error || 'Failed to load'}</div>
      </div>
    );
  }

  const imgSrc = detail.image ? toCachedImageSrc(detail.image, 'anilist') || detail.image : null;
  const altNames = detail.nameAlternative.filter(Boolean).join(', ');
  const spoilerNames = detail.nameSpoiler.filter(Boolean);

  // Process description — find "~!" spoiler markers and convert them
  const rawDesc = detail.description || '';
  const hasSpoilerContent = rawDesc.includes('~!') && rawDesc.includes('!~');
  let sanitizedDesc = '';
  if (rawDesc) {
    if (spoilerVisible) {
      // Show everything, remove markers
      sanitizedDesc = DOMPurify.sanitize(rawDesc.replace(/~!/g, '').replace(/!~/g, ''));
    } else {
      // Hide spoiler content
      sanitizedDesc = DOMPurify.sanitize(rawDesc.replace(/~![\s\S]*?!~/g, '<em style="color: var(--muted-foreground); opacity: 0.6;">[Spoiler — click to reveal]</em>'));
    }
  }

  const birthStr = formatFuzzyDate(detail.dateOfBirth);

  const infoItems = [
    birthStr && { label: 'Birthday', value: birthStr },
    detail.age != null && { label: 'Age', value: String(detail.age) },
    detail.gender && { label: 'Gender', value: detail.gender },
    detail.bloodType && { label: 'Blood Type', value: detail.bloodType },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="animate-content-in">
      <PageHeader className="-mx-2 md:-mx-6" title={detail.name} />

      {/* Character Header */}
      <div className="flex gap-4 mt-2">
        {/* Image */}
        <div className="relative w-28 h-36 sm:w-32 sm:h-44 rounded-xl overflow-hidden bg-muted shrink-0 shadow-lg">
          {imgSrc ? (
            <Image
              src={imgSrc}
              alt={detail.name}
              fill
              sizes="128px"
              className="object-cover"
              unoptimized={isProtectedApiImageSrc(imgSrc)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">?</div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 pt-1">
          <h1 className="text-xl font-bold leading-tight">{detail.name}</h1>
          {detail.nameNative && (
            <p className="text-sm text-muted-foreground mt-0.5">{detail.nameNative}</p>
          )}
          {altNames && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{altNames}</p>
          )}
          {spoilerNames.length > 0 && (
            <button
              onClick={() => setSpoilerNamesVisible(!spoilerNamesVisible)}
              className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground mt-0.5 transition-colors"
            >
              {spoilerNamesVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {spoilerNamesVisible ? spoilerNames.join(', ') : 'Spoiler names'}
            </button>
          )}
          <div className="flex items-center gap-1.5 mt-2">
            <Heart className="h-3.5 w-3.5 text-red-400 fill-red-400" />
            <span className="text-sm font-semibold">{formatFavourites(detail.favourites)}</span>
          </div>

          {/* Bio info */}
          <div className="mt-3 space-y-1">
            {infoItems.map((item) => (
              <div key={item.label} className="flex gap-1.5 text-sm">
                <span className="text-primary font-medium shrink-0">{item.label}:</span>
                <span className="text-foreground">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Description */}
      {sanitizedDesc && (
        <div className="mt-4">
          <div
            className={`text-sm text-muted-foreground leading-relaxed [&_i]:italic [&_br]:mb-2 ${descExpanded ? '' : 'line-clamp-5'}`}
            dangerouslySetInnerHTML={{ __html: sanitizedDesc }}
            onClick={hasSpoilerContent && !spoilerVisible ? () => setSpoilerVisible(true) : undefined}
            style={hasSpoilerContent && !spoilerVisible ? { cursor: 'pointer' } : undefined}
          />
          <div className="flex gap-3 mt-1">
            {sanitizedDesc.length > 200 && (
              <button onClick={() => setDescExpanded(!descExpanded)} className="text-xs text-primary font-medium">
                {descExpanded ? 'Show less' : 'Read more'}
              </button>
            )}
            {hasSpoilerContent && (
              <button
                onClick={() => setSpoilerVisible(!spoilerVisible)}
                className="flex items-center gap-1 text-xs text-primary font-medium"
              >
                {spoilerVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {spoilerVisible ? 'Hide spoilers' : 'Show spoilers'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Media Appearances */}
      {media.length > 0 && (
        <div className="mt-6">
          {/* Header with sort */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Appearances</h2>
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

          {/* Media Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {media.map((edge, idx) => {
              const coverSrc = edge.node.coverImage
                ? toCachedImageSrc(edge.node.coverImage, 'anilist') || edge.node.coverImage
                : null;

              const isManga = edge.node.type === 'MANGA' || edge.node.format === 'MANGA' || edge.node.chapters != null;
              const href = isManga ? `/anime/manga/${edge.node.id}` : `/anime/${edge.node.id}`;
              const va = edge.voiceActors[0];

              return (
                <div key={`${edge.node.id}-${idx}`} className="group">
                  <Link href={href}>
                    <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted shadow-sm group-hover:shadow-md transition-shadow border border-border/30 group-hover:border-primary/40">
                      {coverSrc ? (
                        <Image
                          src={coverSrc}
                          alt={edge.node.title}
                          fill
                          sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, 16vw"
                          className="object-cover transition-transform duration-300 group-hover:scale-105"
                          unoptimized={isProtectedApiImageSrc(coverSrc)}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
                          {edge.node.title}
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/60 to-transparent pointer-events-none" />
                      {edge.node.averageScore != null && edge.node.averageScore > 0 && (
                        <Badge className="absolute top-1 right-1 text-[9px] bg-background/60 text-foreground gap-0.5">
                          <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
                          {edge.node.averageScore}%
                        </Badge>
                      )}
                      <Badge
                        className={`absolute top-1 left-1 text-[9px] ${edge.characterRole === 'MAIN' ? 'bg-blue-500/80 text-foreground' : 'bg-background/60 text-foreground'}`}
                      >
                        {edge.characterRole}
                      </Badge>
                    </div>
                  </Link>
                  <Link href={href}>
                    <p className="mt-1 text-xs font-medium leading-tight line-clamp-2">{edge.node.title}</p>
                  </Link>
                  {va && (
                    <Link href={`/anime/staff/${va.id}`} className="text-[11px] text-muted-foreground hover:text-primary line-clamp-1 transition-colors">
                      {va.name}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>

          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}

      {/* Bottom padding */}
      <div className="h-8" />
    </div>
  );
}
