'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import DOMPurify from 'isomorphic-dompurify';
import { PageHeader } from '@/components/layout/page-header';
import { AnimeHero } from '@/components/anime/anime-hero';
import { AnilistStatusPanel } from '@/components/anime/anilist-status-panel';
import { AnimeRelationsSection } from '@/components/anime/anime-relations-section';
import { AnimeMediaRail } from '@/components/anime/anime-media-rail';
import { AnimeReviewCard } from '@/components/anime/anime-review-card';
import { DiscoverInfoRows } from '@/components/discover/discover-info-rows';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ExternalLink } from 'lucide-react';
import type { AniListMangaDetailResponse } from '@/types/anilist';
import { useQuery } from '@tanstack/react-query';
import {
  getDetailViewState,
  setDetailViewState,
  waitForScrollY,
  type DetailViewKey,
} from '@/lib/detail-view-state';

export default function MangaDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const detailViewKey: DetailViewKey = `manga:${id}`;
  const scrollReadyRef = useRef(false);
  const hasRestoredScrollRef = useRef(false);
  // gcTime gives instant back-nav paint without the bespoke snapshot cache.
  const detailQuery = useQuery({
    queryKey: ['anime', 'manga', id],
    queryFn: async ({ signal }): Promise<AniListMangaDetailResponse> => {
      const res = await fetch(`/api/anime/manga/${id}`, { signal });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load');
      }
      return res.json() as Promise<AniListMangaDetailResponse>;
    },
    enabled: !!id,
  });
  const detail = detailQuery.data ?? null;
  const loading = detailQuery.isLoading;
  const error = detailQuery.isError
    ? detailQuery.error instanceof Error
      ? detailQuery.error.message
      : 'Failed to load'
    : null;
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);

  // Reset scroll-restore guards when navigating to a different manga.
  useEffect(() => {
    scrollReadyRef.current = false;
    hasRestoredScrollRef.current = false;
  }, [id]);

  useEffect(() => {
    if (loading || !detail || hasRestoredScrollRef.current) return;
    const saved = getDetailViewState(detailViewKey);
    if (!saved || saved.scrollY <= 0) {
      hasRestoredScrollRef.current = true;
      scrollReadyRef.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      await waitForScrollY(saved.scrollY);
      if (cancelled) return;
      window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      hasRestoredScrollRef.current = true;
      scrollReadyRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [detailViewKey, loading, detail]);

  useEffect(() => {
    const persistScroll = () => {
      if (!scrollReadyRef.current) return;
      setDetailViewState(detailViewKey, { scrollY: window.scrollY });
    };

    let lastSaved = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastSaved < 150) return;
      lastSaved = now;
      persistScroll();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', persistScroll);
    return () => {
      persistScroll();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', persistScroll);
    };
  }, [detailViewKey]);

  if (loading && !detail) {
    return <><PageHeader className='-mx-2 md:-mx-6' title="Manga" /><PageSpinner /></>;
  }

  if (error || !detail) {
    return (
      <div>
        <PageHeader className='-mx-2 md:-mx-6' title="Error" />
        <div className="p-4 text-center text-muted-foreground">
          {error || 'Failed to load manga details'}
        </div>
      </div>
    );
  }

  const nonSpoilerTags = detail.tags.filter((t) => !t.isSpoiler);
  const sanitizedDescription = detail.description ? DOMPurify.sanitize(detail.description) : '';

  // Build info rows
  const infoRows = [];
  if (detail.format) infoRows.push({ label: 'Format', value: detail.format.replace('_', ' ') });
  if (detail.status) infoRows.push({ label: 'Status', value: detail.status.charAt(0) + detail.status.slice(1).toLowerCase().replace(/_/g, ' ') });
  if (detail.chapters != null) infoRows.push({ label: 'Chapters', value: String(detail.chapters) });
  if (detail.volumes != null) infoRows.push({ label: 'Volumes', value: String(detail.volumes) });
  if (detail.source) {
    infoRows.push({ label: 'Source', value: detail.source.replace(/_/g, ' ').split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') });
  }
  if (detail.averageScore != null) {
    infoRows.push({ label: 'Average Score', value: `${detail.averageScore}%` });
  }
  if (detail.popularity != null) {
    infoRows.push({ label: 'Popularity', value: detail.popularity.toLocaleString() });
  }
  if (detail.favourites != null) {
    infoRows.push({ label: 'Favourites', value: detail.favourites.toLocaleString() });
  }
  if (detail.startDate?.year) {
    const parts = [detail.startDate.year];
    if (detail.startDate.month) parts.unshift(detail.startDate.month);
    infoRows.push({ label: 'Start Date', value: parts.join('/') });
  }
  if (detail.endDate?.year) {
    const parts = [detail.endDate.year];
    if (detail.endDate.month) parts.unshift(detail.endDate.month);
    infoRows.push({ label: 'End Date', value: parts.join('/') });
  }

  // External links
  const anilistLink = `https://anilist.co/manga/${detail.id}`;
  const importantLinks = [
    { label: 'AniList', url: anilistLink },
    ...detail.externalLinks
      .filter((l) => l.url)
      .slice(0, 5)
      .map((l) => ({ label: l.site, url: l.url! })),
  ];

  return (
    <div className="animate-content-in" onClickCapture={() => setDetailViewState(detailViewKey, { scrollY: window.scrollY })}>
      <PageHeader className='-mx-2 md:-mx-6' title={detail.title} />

      {/* Hero */}
      <AnimeHero
        title={detail.title}
        bannerImage={detail.bannerImage}
        coverImage={detail.coverImage}
        format={detail.format}
        averageScore={detail.averageScore}
        episodes={null}
        status={detail.status}
        season={null}
        seasonYear={null}
        studios={[]}
      />

      <div className="space-y-5 mt-4">
        <AnilistStatusPanel
          mediaId={detail.id}
          mediaTitle={detail.title}
          mediaType="MANGA"
          totalChapters={detail.chapters}
          totalVolumes={detail.volumes}
        />

        {/* Synopsis */}
        {sanitizedDescription && (
          <div>
            <h2 className="text-base font-semibold mb-1">Synopsis</h2>
            <div
              className={`text-sm text-muted-foreground leading-relaxed [&_i]:italic [&_br]:mb-2 ${synopsisExpanded ? '' : 'line-clamp-5'}`}
              dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
            />
            {sanitizedDescription.length > 200 && (
              <button
                onClick={() => setSynopsisExpanded(!synopsisExpanded)}
                className="text-xs text-primary mt-1 font-medium"
              >
                {synopsisExpanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </div>
        )}

        {/* Info Rows */}
        <DiscoverInfoRows title="Information" rows={infoRows} />

        {/* Genres + Tags */}
        {(detail.genres.length > 0 || nonSpoilerTags.length > 0) && (
          <div>
            <h2 className="text-base font-semibold mb-2">Genres & Tags</h2>
            <div className="flex flex-wrap gap-1.5">
              {detail.genres.map((genre) => (
                <Badge key={genre} variant="secondary" className="text-xs">
                  {genre}
                </Badge>
              ))}
              {nonSpoilerTags.slice(0, 15).map((tag) => (
                <Badge key={tag.name} variant="outline" className="text-xs">
                  {tag.name}
                  <span className="ml-1 text-muted-foreground">{tag.rank}%</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Staff */}
        {detail.staff.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">Staff</h2>
            <div className="grid grid-cols-2 gap-2">
              {detail.staff.map((person, index) => (
                <Link
                  key={`${person.id}-${person.role}-${index}`}
                  href={`/anime/staff/${person.id}`}
                  className="flex items-center gap-2 bg-muted/20 rounded-lg p-2 border border-border/30 hover:border-primary/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{person.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{person.role}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Relations */}
        <AnimeRelationsSection relations={detail.relations} />

        {/* Recommendations */}
        <AnimeMediaRail title="Recommendations" items={detail.recommendations} />
        {/* Reviews */}
        <AnimeReviewCard reviews={detail.reviews} />

        {/* External Links */}
        {importantLinks.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">External Links</h2>
            <div className="flex flex-wrap gap-2">
              {importantLinks.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary bg-muted/30 rounded-lg px-3 py-1.5 border border-border/30 hover:bg-muted/50 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
