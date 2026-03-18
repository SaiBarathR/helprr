'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
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
import { ExternalLink, Tv, Film, Loader2, Clock, Trophy, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { AniListDetailResponse, AniListFuzzyDate } from '@/types/anilist';
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

function formatFuzzyDate(date: AniListFuzzyDate | null): string | null {
  if (!date || !date.year) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (date.month && date.day) {
    return `${months[date.month - 1]} ${date.day}, ${date.year}`;
  }
  if (date.month) {
    return `${months[date.month - 1]} ${date.year}`;
  }
  return String(date.year);
}

function formatCountdown(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

const STATUS_COLORS: Record<string, string> = {
  CURRENT: 'bg-blue-500',
  PLANNING: 'bg-green-500',
  COMPLETED: 'bg-violet-500',
  PAUSED: 'bg-yellow-500',
  DROPPED: 'bg-red-500',
};

const STATUS_LABELS: Record<string, string> = {
  CURRENT: 'Current',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
};

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
  if (detail.episodes != null) infoRows.push({ label: 'Episodes', value: String(detail.episodes) });
  if (detail.duration != null) infoRows.push({ label: 'Episode Duration', value: `${detail.duration} mins` });
  if (detail.status) infoRows.push({ label: 'Status', value: detail.status.charAt(0) + detail.status.slice(1).toLowerCase().replace(/_/g, ' ') });
  const startDateStr = formatFuzzyDate(detail.startDate);
  if (startDateStr) infoRows.push({ label: 'Start Date', value: startDateStr });
  const endDateStr = formatFuzzyDate(detail.endDate);
  if (endDateStr) infoRows.push({ label: 'End Date', value: endDateStr });
  if (detail.season && detail.seasonYear) {
    infoRows.push({ label: 'Season', value: `${detail.season.charAt(0)}${detail.season.slice(1).toLowerCase()} ${detail.seasonYear}` });
  }
  if (detail.averageScore != null) infoRows.push({ label: 'Average Score', value: `${detail.averageScore}%` });
  if (detail.meanScore != null) infoRows.push({ label: 'Mean Score', value: `${detail.meanScore}%` });
  if (detail.popularity != null) infoRows.push({ label: 'Popularity', value: detail.popularity.toLocaleString() });
  if (detail.favourites != null) infoRows.push({ label: 'Favorites', value: detail.favourites.toLocaleString() });
  const mainStudios = detail.studios.filter((s) => s.isMain);
  if (mainStudios.length) {
    infoRows.push({ label: 'Studios', value: mainStudios.map((s) => s.name).join(', ') });
  }
  const producers = detail.studios.filter((s) => !s.isMain);
  if (producers.length) {
    infoRows.push({ label: 'Producers', value: producers.map((s) => s.name).join(', ') });
  }
  if (detail.source) {
    infoRows.push({ label: 'Source', value: detail.source.replace(/_/g, ' ').split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') });
  }
  if (detail.hashtag) infoRows.push({ label: 'Hashtag', value: detail.hashtag });

  // Alternative titles
  const altTitles: { label: string; value: string }[] = [];
  if (detail.titleRomaji) altTitles.push({ label: 'Romaji', value: detail.titleRomaji });
  const englishTitle = detail.title !== detail.titleRomaji ? detail.title : null;
  if (englishTitle && englishTitle !== detail.titleNative) altTitles.push({ label: 'English', value: englishTitle });
  if (detail.titleNative) altTitles.push({ label: 'Native', value: detail.titleNative });
  if (detail.synonyms.length > 0) altTitles.push({ label: 'Synonyms', value: detail.synonyms.join(', ') });

  // Score distribution
  const scoreDistribution = detail.scoreDistribution ?? [];
  const maxScoreAmount = scoreDistribution.length > 0 ? Math.max(...scoreDistribution.map((s) => s.amount)) : 0;

  // Status distribution
  const statusDistribution = detail.statusDistribution ?? [];
  const totalStatusUsers = statusDistribution.reduce((sum, s) => sum + s.amount, 0);

  // Rankings
  const rankings = detail.rankings ?? [];

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

        {/* Airing Countdown */}
        {detail.nextAiringEpisode && (
          <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2.5">
            <Clock className="h-4 w-4 text-blue-400 shrink-0" />
            <div className="text-sm">
              <span className="font-medium">Ep {detail.nextAiringEpisode.episode}</span>
              <span className="text-muted-foreground"> airing in </span>
              <span className="font-medium text-blue-400">{formatCountdown(detail.nextAiringEpisode.timeUntilAiring)}</span>
            </div>
          </div>
        )}

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

        {/* Alternative Titles */}
        {altTitles.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">Alternative Titles</h2>
            <div>
              {altTitles.map((t) => (
                <div
                  key={t.label}
                  className="flex justify-between items-start py-2.5 border-b border-border/40 last:border-b-0"
                >
                  <span className="text-sm text-muted-foreground shrink-0">{t.label}</span>
                  <span className="text-sm text-right ml-4">{t.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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

        {/* Staff (with images) */}
        {detail.staff.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">Staff</h2>
            <div className="grid grid-cols-2 gap-2">
              {detail.staff.map((person, index) => {
                const staffImgSrc = person.image
                  ? toCachedImageSrc(person.image, 'anilist') || person.image
                  : null;
                return (
                  <div
                    key={`${person.id}-${person.role}-${index}`}
                    className="flex items-center gap-2 bg-muted/20 rounded-lg p-2 border border-border/30"
                  >
                    <div className="relative w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0">
                      {staffImgSrc ? (
                        <Image
                          src={staffImgSrc}
                          alt={person.name}
                          fill
                          sizes="40px"
                          className="object-cover"
                          unoptimized={isProtectedApiImageSrc(staffImgSrc)}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[10px]">
                          ?
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{person.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{person.role}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Rankings */}
        {rankings.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">Rankings</h2>
            <div className="space-y-1.5">
              {rankings.map((ranking) => (
                <div
                  key={ranking.id}
                  className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2 border border-border/30"
                >
                  {ranking.type === 'RATED' ? (
                    <Trophy className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                  ) : (
                    <TrendingUp className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  )}
                  <span className="text-sm">
                    <span className="font-semibold">#{ranking.rank}</span>
                    {' '}{ranking.context}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status Distribution */}
        {statusDistribution.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">Status Distribution</h2>
            {/* Stacked bar */}
            {totalStatusUsers > 0 && (
              <div className="flex h-3 rounded-full overflow-hidden mb-3">
                {statusDistribution.map((s) => (
                  <div
                    key={s.status}
                    className={`${STATUS_COLORS[s.status] || 'bg-gray-500'}`}
                    style={{ width: `${(s.amount / totalStatusUsers) * 100}%` }}
                  />
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {statusDistribution.map((s) => (
                <div key={s.status} className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_COLORS[s.status] || 'bg-gray-500'}`} />
                  <div className="text-sm">
                    <span className="text-muted-foreground">{STATUS_LABELS[s.status] || s.status}</span>
                    <span className="ml-1.5 font-medium">{s.amount.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Score Distribution */}
        {scoreDistribution.length > 0 && maxScoreAmount > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">Score Distribution</h2>
            <div className="flex items-end gap-1 h-28">
              {scoreDistribution
                .sort((a, b) => a.score - b.score)
                .map((s) => {
                  const height = (s.amount / maxScoreAmount) * 100;
                  const barColor = s.score >= 70
                    ? 'bg-green-500'
                    : s.score >= 50
                      ? 'bg-yellow-500'
                      : 'bg-red-500';
                  return (
                    <div key={s.score} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">{s.amount > 0 ? s.amount.toLocaleString() : ''}</span>
                      <div className="w-full flex items-end" style={{ height: '80px' }}>
                        <div
                          className={`w-full rounded-t-sm ${barColor}`}
                          style={{ height: `${Math.max(height, 2)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{s.score}</span>
                    </div>
                  );
                })}
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
