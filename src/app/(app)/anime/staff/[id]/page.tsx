'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import DOMPurify from 'isomorphic-dompurify';
import { PageHeader } from '@/components/layout/page-header';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Badge } from '@/components/ui/badge';
import { Heart, Loader2, Star, ChevronDown } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { formatFavourites, formatFuzzyDate } from '@/lib/anilist-helpers';
import type {
  AniListStaffDetailResponse,
  AniListStaffMediaEdge,
  AniListStaffVoiceActingEdge,
  AniListPageInfo,
} from '@/types/anilist';

const DEFAULT_SORT = 'POPULARITY_DESC';
const SORT_OPTIONS = [
  { value: 'POPULARITY_DESC', label: 'Popularity' },
  { value: 'SCORE_DESC', label: 'Average Score' },
  { value: 'FAVOURITES_DESC', label: 'Favourites' },
  { value: 'START_DATE_DESC', label: 'Newest' },
  { value: 'START_DATE', label: 'Oldest' },
  { value: 'TITLE_ROMAJI', label: 'Title' },
];

export default function StaffDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [detail, setDetail] = useState<AniListStaffDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);

  // Anime media state
  const [animeMedia, setAnimeMedia] = useState<AniListStaffMediaEdge[]>([]);
  const [animePageInfo, setAnimePageInfo] = useState<AniListPageInfo | null>(null);
  const [animeSort, setAnimeSort] = useState(DEFAULT_SORT);
  const [animeLoadingMore, setAnimeLoadingMore] = useState(false);
  const [animeSortOpen, setAnimeSortOpen] = useState(false);
  const animeSentinelRef = useRef<HTMLDivElement>(null);

  // Manga media state
  const [mangaMedia, setMangaMedia] = useState<AniListStaffMediaEdge[]>([]);
  const [mangaPageInfo, setMangaPageInfo] = useState<AniListPageInfo | null>(null);
  const [mangaSort, setMangaSort] = useState(DEFAULT_SORT);
  const [mangaLoadingMore, setMangaLoadingMore] = useState(false);
  const [mangaSortOpen, setMangaSortOpen] = useState(false);
  const mangaSentinelRef = useRef<HTMLDivElement>(null);

  // Voice acting state
  const [vaMedia, setVaMedia] = useState<AniListStaffVoiceActingEdge[]>([]);
  const [vaPageInfo, setVaPageInfo] = useState<AniListPageInfo | null>(null);
  const [vaSort, setVaSort] = useState(DEFAULT_SORT);
  const [vaLoadingMore, setVaLoadingMore] = useState(false);
  const [vaSortOpen, setVaSortOpen] = useState(false);
  const vaSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAnimeSort(DEFAULT_SORT);
    setMangaSort(DEFAULT_SORT);
    setVaSort(DEFAULT_SORT);
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      animeSort,
      mangaSort,
      vaSort,
    });

    fetch(`/api/anime/staff/${id}?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load');
        return res.json();
      })
      .then((data: AniListStaffDetailResponse) => {
        if (!controller.signal.aborted) {
          setDetail(data);
          setAnimeMedia(data.animeMedia);
          setAnimePageInfo(data.animePageInfo);
          setMangaMedia(data.mangaMedia);
          setMangaPageInfo(data.mangaPageInfo);
          setVaMedia(data.voiceActingMedia);
          setVaPageInfo(data.voiceActingPageInfo);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e.message);
        setLoading(false);
      });

    return () => controller.abort();
  }, [id, animeSort, mangaSort, vaSort]);

  // Fetch more anime
  const fetchMoreAnime = useCallback(async () => {
    if (!animePageInfo?.hasNextPage || animeLoadingMore) return;
    setAnimeLoadingMore(true);
    try {
      const page = (animePageInfo.currentPage || 1) + 1;
      const res = await fetch(`/api/anime/staff/${id}?page=${page}&sort=${animeSort}&type=ANIME`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setAnimeMedia((prev) => [...prev, ...data.edges]);
      setAnimePageInfo(data.pageInfo);
    } catch (e) {
      console.error(e);
    } finally {
      setAnimeLoadingMore(false);
    }
  }, [id, animePageInfo, animeLoadingMore, animeSort]);

  // Fetch more manga
  const fetchMoreManga = useCallback(async () => {
    if (!mangaPageInfo?.hasNextPage || mangaLoadingMore) return;
    setMangaLoadingMore(true);
    try {
      const page = (mangaPageInfo.currentPage || 1) + 1;
      const res = await fetch(`/api/anime/staff/${id}?page=${page}&sort=${mangaSort}&type=MANGA`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setMangaMedia((prev) => [...prev, ...data.edges]);
      setMangaPageInfo(data.pageInfo);
    } catch (e) {
      console.error(e);
    } finally {
      setMangaLoadingMore(false);
    }
  }, [id, mangaPageInfo, mangaLoadingMore, mangaSort]);

  // Fetch more voice acting
  const fetchMoreVa = useCallback(async () => {
    if (!vaPageInfo?.hasNextPage || vaLoadingMore) return;
    setVaLoadingMore(true);
    try {
      const page = (vaPageInfo.currentPage || 1) + 1;
      const res = await fetch(`/api/anime/staff/${id}?page=${page}&sort=${vaSort}&type=VOICE_ACTING`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setVaMedia((prev) => [...prev, ...data.edges]);
      setVaPageInfo(data.pageInfo);
    } catch (e) {
      console.error(e);
    } finally {
      setVaLoadingMore(false);
    }
  }, [id, vaPageInfo, vaLoadingMore, vaSort]);

  // Anime infinite scroll
  useEffect(() => {
    if (!animeSentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && animePageInfo?.hasNextPage && !animeLoadingMore) {
          fetchMoreAnime();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(animeSentinelRef.current);
    return () => observer.disconnect();
  }, [animePageInfo, animeLoadingMore, fetchMoreAnime]);

  // Manga infinite scroll
  useEffect(() => {
    if (!mangaSentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && mangaPageInfo?.hasNextPage && !mangaLoadingMore) {
          fetchMoreManga();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(mangaSentinelRef.current);
    return () => observer.disconnect();
  }, [mangaPageInfo, mangaLoadingMore, fetchMoreManga]);

  // Voice acting infinite scroll
  useEffect(() => {
    if (!vaSentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && vaPageInfo?.hasNextPage && !vaLoadingMore) {
          fetchMoreVa();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(vaSentinelRef.current);
    return () => observer.disconnect();
  }, [vaPageInfo, vaLoadingMore, fetchMoreVa]);

  if (loading) {
    return <><PageHeader className="-mx-2 md:-mx-6" title="Staff" /><PageSpinner /></>;
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
  const altNames = [detail.nameNative, ...detail.nameAlternative].filter(Boolean).join(', ');
  const sanitizedDesc = detail.description ? DOMPurify.sanitize(detail.description) : '';

  const birthStr = formatFuzzyDate(detail.dateOfBirth);
  const deathStr = formatFuzzyDate(detail.dateOfDeath);
  const yearsStr = detail.yearsActive.length > 0
    ? detail.yearsActive.length === 1
      ? `${detail.yearsActive[0]}-Present`
      : `${detail.yearsActive[0]}-${detail.yearsActive[1]}`
    : null;

  const infoItems = [
    birthStr && { label: 'Birth', value: birthStr },
    deathStr && { label: 'Death', value: deathStr },
    detail.age != null && { label: 'Age', value: String(detail.age) },
    detail.gender && { label: 'Gender', value: detail.gender },
    yearsStr && { label: 'Years Active', value: yearsStr },
    detail.homeTown && { label: 'Hometown', value: detail.homeTown },
    detail.bloodType && { label: 'Blood Type', value: detail.bloodType },
    detail.languageV2 && { label: 'Language', value: detail.languageV2 },
    detail.primaryOccupations.length > 0 && { label: 'Occupations', value: detail.primaryOccupations.join(', ') },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="animate-content-in">
      <PageHeader className="-mx-2 md:-mx-6" title={detail.name} />

      {/* Staff Header */}
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
          {altNames && (
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{altNames}</p>
          )}
          <div className="flex items-center gap-1.5 mt-2">
            <Heart className="h-3.5 w-3.5 text-red-400 fill-red-400" />
            <span className="text-sm font-semibold">{formatFavourites(detail.favourites)}</span>
          </div>

          {/* Bio info */}
          <div className="mt-3 space-y-1">
            {infoItems.slice(0, 6).map((item) => (
              <div key={item.label} className="flex gap-1.5 text-sm">
                <span className="text-primary font-medium shrink-0">{item.label}:</span>
                <span className="text-foreground">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Remaining bio items (if many) */}
      {infoItems.length > 6 && (
        <div className="mt-2 space-y-1">
          {infoItems.slice(6).map((item) => (
            <div key={item.label} className="flex gap-1.5 text-sm">
              <span className="text-primary font-medium shrink-0">{item.label}:</span>
              <span className="text-foreground">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Description */}
      {sanitizedDesc && (
        <div className="mt-4">
          <div
            className={`text-sm text-muted-foreground leading-relaxed [&_a]:text-primary [&_a:hover]:underline [&_i]:italic [&_p]:mb-2 ${descExpanded ? '' : 'line-clamp-4'}`}
            dangerouslySetInnerHTML={{ __html: sanitizedDesc }}
          />
          {sanitizedDesc.length > 200 && (
            <button
              onClick={() => setDescExpanded(!descExpanded)}
              className="text-xs text-primary mt-1 font-medium"
            >
              {descExpanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      )}

      {/* External links */}
      {detail.siteUrl && (
        <div className="mt-3">
          <a
            href={detail.siteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            AniList
          </a>
        </div>
      )}

      {/* VOICE ACTING ROLES */}
      {vaMedia.length > 0 && (
        <div className="mt-6">
          <StaffMediaSection
            title="VOICE ACTING ROLES"
            media={vaMedia.map<AniListStaffMediaEdge>((edge) => ({
              staffRole:
                edge.characterName ||
                edge.characters.map((c) => c.name).filter(Boolean).join(', ') ||
                'Voice Actor',
              node: edge.node,
            }))}
            sort={vaSort}
            onSortChange={setVaSort}
            sortOpen={vaSortOpen}
            onSortOpenChange={setVaSortOpen}
            sentinelRef={vaSentinelRef}
            loadingMore={vaLoadingMore}
            linkPrefix="/anime"
          />
        </div>
      )}

      {/* ANIME STAFF ROLES */}
      {animeMedia.length > 0 && (
        <div className="mt-6">
          <StaffMediaSection
            title="ANIME STAFF ROLES"
            media={animeMedia}
            sort={animeSort}
            onSortChange={setAnimeSort}
            sortOpen={animeSortOpen}
            onSortOpenChange={setAnimeSortOpen}
            sentinelRef={animeSentinelRef}
            loadingMore={animeLoadingMore}
            linkPrefix="/anime"
          />
        </div>
      )}

      {/* MANGA STAFF ROLES */}
      {mangaMedia.length > 0 && (
        <div className="mt-6">
          <StaffMediaSection
            title="MANGA STAFF ROLES"
            media={mangaMedia}
            sort={mangaSort}
            onSortChange={setMangaSort}
            sortOpen={mangaSortOpen}
            onSortOpenChange={setMangaSortOpen}
            sentinelRef={mangaSentinelRef}
            loadingMore={mangaLoadingMore}
            linkPrefix="/anime/manga"
          />
        </div>
      )}

      {/* Bottom padding */}
      <div className="h-8" />
    </div>
  );
}

// --- Reusable Staff Media Section ---

function StaffMediaSection({
  title,
  media,
  sort,
  onSortChange,
  sortOpen,
  onSortOpenChange,
  sentinelRef,
  loadingMore,
  linkPrefix,
}: {
  title: string;
  media: AniListStaffMediaEdge[];
  sort: string;
  onSortChange: (s: string) => void;
  sortOpen: boolean;
  onSortOpenChange: (v: boolean) => void;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  loadingMore: boolean;
  linkPrefix: string;
}) {
  // Group media by id, combine roles
  const grouped = new Map<number, { edge: AniListStaffMediaEdge; roles: string[] }>();
  for (const edge of media) {
    const existing = grouped.get(edge.node.id);
    if (existing) {
      existing.roles.push(edge.staffRole);
    } else {
      grouped.set(edge.node.id, { edge, roles: [edge.staffRole] });
    }
  }

  const sortDropdownRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        onSortOpenChange(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sortOpen, onSortOpenChange]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{title}</h2>
        <div className="relative" ref={sortDropdownRef}>
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={() => onSortOpenChange(!sortOpen)}
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
                  onClick={() => {
                    onSortChange(opt.value);
                    onSortOpenChange(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
        {Array.from(grouped.values()).map(({ edge, roles }) => {
          const imgSrc = edge.node.coverImage
            ? toCachedImageSrc(edge.node.coverImage, 'anilist') || edge.node.coverImage
            : null;

          const href = `${linkPrefix}/${edge.node.id}`;

          return (
            <Link key={edge.node.id} href={href} className="group">
              <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted shadow-sm group-hover:shadow-md transition-shadow border border-border/30 group-hover:border-primary/40">
                {imgSrc ? (
                  <Image
                    src={imgSrc}
                    alt={edge.node.title}
                    fill
                    sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, 16vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    unoptimized={isProtectedApiImageSrc(imgSrc)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
                    {edge.node.title}
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                {edge.node.averageScore != null && edge.node.averageScore > 0 && (
                  <Badge className="absolute top-1 right-1 text-[9px] bg-black/60 text-white gap-0.5">
                    <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
                    {edge.node.averageScore}%
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs font-medium leading-tight line-clamp-2">{edge.node.title}</p>
              <p className="text-[11px] text-muted-foreground line-clamp-2 whitespace-pre-line">{roles.join('\n')}</p>
            </Link>
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
  );
}
