'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import DOMPurify from 'isomorphic-dompurify';
import { PageHeader } from '@/components/layout/page-header';
import { AnimeHero } from '@/components/anime/anime-hero';
import { AnimeAddButton } from '@/components/anime/anime-add-button';
import { AnimeCharacterRail } from '@/components/anime/anime-character-rail';
import { AnimeRelationsSection } from '@/components/anime/anime-relations-section';
import { AnimeMediaRail } from '@/components/anime/anime-media-rail';
import { AnimeReviewCard } from '@/components/anime/anime-review-card';
import { DiscoverInfoRows } from '@/components/discover/discover-info-rows';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, Tv, Film, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AniListDetailResponse } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';

type DetailWithLibrary = AniListDetailResponse & {
  library?: DiscoverLibraryStatus | null;
  libraryAvailability?: {
    radarr: 'ok' | 'unavailable';
    sonarr: 'ok' | 'unavailable';
  };
};
interface DetailState {
  id: string;
  detail: DetailWithLibrary | null;
  error: string | null;
  loading: boolean;
}

export default function AnimeDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [state, setState] = useState<DetailState>(() => ({
    id,
    detail: null,
    error: null,
    loading: true,
  }));
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const externalUrls = useExternalUrls();
  const [jellyfinLoading, setJellyfinLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/anime/${id}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load');
        }
        return res.json();
      })
      .then((data: DetailWithLibrary) => {
        if (!controller.signal.aborted) {
          setState({
            id,
            detail: data,
            error: null,
            loading: false,
          });
        }
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState({
          id,
          detail: null,
          error: e.message,
          loading: false,
        });
      });

    return () => controller.abort();
  }, [id]);

  const detail = state.id === id ? state.detail : null;
  const loading = state.id === id ? state.loading : true;
  const error = state.id === id ? state.error : null;

  if (loading) {
    return (
      <div>
        <PageHeader title="Loading..." />
        <Skeleton className="h-[220px] w-full" />
        <div className="p-4 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div>
        <PageHeader title="Error" />
        <div className="p-4 text-center text-muted-foreground">
          {error || 'Failed to load anime details'}
        </div>
      </div>
    );
  }

  const nonSpoilerTags = detail.tags.filter((t) => !t.isSpoiler);
  const sanitizedDescription = detail.description ? DOMPurify.sanitize(detail.description) : '';

  // Build info rows
  const infoRows = [];
  if (detail.format) infoRows.push({ label: 'Format', value: detail.format.replace(/_/g, ' ') });
  if (detail.status) infoRows.push({ label: 'Status', value: detail.status.charAt(0) + detail.status.slice(1).toLowerCase().replace(/_/g, ' ') });
  if (detail.episodes != null) infoRows.push({ label: 'Episodes', value: String(detail.episodes) });
  if (detail.duration != null) infoRows.push({ label: 'Duration', value: `${detail.duration} min` });
  if (detail.season && detail.seasonYear) {
    infoRows.push({ label: 'Season', value: `${detail.season.charAt(0)}${detail.season.slice(1).toLowerCase()} ${detail.seasonYear}` });
  }
  if (detail.source) {
    infoRows.push({ label: 'Source', value: detail.source.replace(/_/g, ' ').split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') });
  }
  const mainStudios = detail.studios.filter((s) => s.isMain);
  if (mainStudios.length) {
    infoRows.push({ label: 'Studios', value: mainStudios.map((s) => s.name).join(', ') });
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

  // External links
  const anilistLink = `https://anilist.co/anime/${detail.id}`;
  const malLink = detail.malId ? `https://myanimelist.net/anime/${detail.malId}` : null;
  // Build library "Open in" links
  const showJellyfinLink = !!(detail.library?.exists && externalUrls.JELLYFIN && (detail.tvdbId || detail.tmdbId));
  async function handleOpenInJellyfin() {
    if (!externalUrls.JELLYFIN) return;
    const popup = window.open('', '_blank');
    if (!popup) {
      toast.error('Popup blocked');
      return;
    }

    setJellyfinLoading(true);
    try {
      const params = new URLSearchParams();
      if (detail!.tvdbId) params.set('tvdbId', String(detail!.tvdbId));
      if (detail!.tmdbId) params.set('tmdbId', String(detail!.tmdbId));
      if (!params.toString()) {
        popup.close();
        toast.error('No provider IDs available');
        return;
      }
      const res = await fetch(`/api/jellyfin/lookup?${params}`);
      const data = res.ok ? await res.json() : null;
      if (data?.itemId) {
        popup.location.href = `${externalUrls.JELLYFIN}/web/index.html#!/details?id=${data.itemId}`;
      } else {
        popup.close();
        toast.error('Not found in Jellyfin');
      }
    } catch {
      popup.close();
      toast.error('Jellyfin lookup failed');
    } finally {
      setJellyfinLoading(false);
    }
  }

  const libraryLinks: { label: string; url: string; icon: 'sonarr' | 'radarr' }[] = [];
  if (detail.library?.exists) {
    if (detail.library.type === 'series' && externalUrls.SONARR && detail.library.titleSlug) {
      libraryLinks.push({ label: 'Open in Sonarr', url: `${externalUrls.SONARR}/series/${detail.library.titleSlug}`, icon: 'sonarr' });
    }
    if (detail.library.type === 'movie' && externalUrls.RADARR && detail.library.tmdbId) {
      libraryLinks.push({ label: 'Open in Radarr', url: `${externalUrls.RADARR}/movie/${detail.library.tmdbId}`, icon: 'radarr' });
    }
  }

  const importantLinks = [
    { label: 'AniList', url: anilistLink },
    ...(malLink ? [{ label: 'MyAnimeList', url: malLink }] : []),
    ...detail.externalLinks
      .filter((l) => l.url && ['Crunchyroll', 'Funimation', 'HIDIVE', 'Netflix', 'YouTube'].includes(l.site))
      .map((l) => ({ label: l.site, url: l.url! })),
  ];

  return (
    <div className="pb-20">
      <PageHeader title={detail.title} />

      {/* Hero */}
      <AnimeHero
        title={detail.title}
        bannerImage={detail.bannerImage}
        coverImage={detail.coverImage}
        format={detail.format}
        averageScore={detail.averageScore}
        episodes={detail.episodes}
        status={detail.status}
        season={detail.season}
        seasonYear={detail.seasonYear}
        studios={detail.studios}
      />

      <div className="space-y-5 mt-4">
        {/* Add Button */}
        <AnimeAddButton
          title={detail.title}
          format={detail.format}
          tvdbId={detail.tvdbId}
          tmdbId={detail.tmdbId}
          library={detail.library ?? undefined}
          libraryAvailability={detail.libraryAvailability}
        />

        {/* Trailer */}
        {detail.trailer?.id && (detail.trailer.site === 'youtube' || detail.trailer.site === 'dailymotion') && (
          <div>
            <h2 className="text-base font-semibold mb-2">Trailer</h2>
            <div className="aspect-video rounded-lg overflow-hidden">
              <iframe
                src={
                  detail.trailer.site === 'youtube'
                    ? `https://www.youtube.com/embed/${detail.trailer.id}`
                    : `https://www.dailymotion.com/embed/video/${detail.trailer.id}`
                }
                title="Trailer"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
          </div>
        )}

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

        {/* Characters */}
        <AnimeCharacterRail characters={detail.characters} />

        {/* Staff */}
        {detail.staff.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">Staff</h2>
            <div className="grid grid-cols-2 gap-2">
              {detail.staff.map((person, index) => (
                <div
                  key={`${person.id}-${person.role}-${index}`}
                  className="flex items-center gap-2 bg-muted/20 rounded-lg p-2 border border-border/30"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{person.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{person.role}</p>
                  </div>
                </div>
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
        {(importantLinks.length > 0 || libraryLinks.length > 0 || showJellyfinLink) && (
          <div>
            <h2 className="text-base font-semibold mb-2">External Links</h2>
            <div className="flex flex-wrap gap-2">
              {libraryLinks.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary bg-muted/30 rounded-lg px-3 py-1.5 border border-border/30 hover:bg-muted/50 transition-colors"
                >
                  {link.icon === 'sonarr' && <Tv className="h-3 w-3" />}
                  {link.icon === 'radarr' && <Film className="h-3 w-3" />}
                  {link.label}
                </a>
              ))}
              {showJellyfinLink && (
                <button
                  onClick={handleOpenInJellyfin}
                  disabled={jellyfinLoading}
                  className="inline-flex items-center gap-1 text-sm text-primary bg-muted/30 rounded-lg px-3 py-1.5 border border-border/30 hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  {jellyfinLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                  Open in Jellyfin
                </button>
              )}
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
