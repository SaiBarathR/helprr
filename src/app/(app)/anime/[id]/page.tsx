'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import DOMPurify from 'isomorphic-dompurify';
import { PageHeader } from '@/components/layout/page-header';
import { AnimeHero } from '@/components/anime/anime-hero';
import { AnimeAddButton } from '@/components/anime/anime-add-button';
import { WatchlistButton } from '@/components/watchlist/watchlist-button';
import { ScheduledAlertButton } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import { AnilistStatusPanel } from '@/components/anime/anilist-status-panel';
import { AnimeCharacterRail } from '@/components/anime/anime-character-rail';
import { AnimeRelationsSection } from '@/components/anime/anime-relations-section';
import { AnimeMediaRail } from '@/components/anime/anime-media-rail';
import { AnimeReviewCard } from '@/components/anime/anime-review-card';
import { AnimeTrailerRail } from '@/components/anime/anime-trailer-rail';
import { DiscoverInfoRows } from '@/components/discover/discover-info-rows';
import { SonarrMapDrawer } from '@/components/anime/sonarr-map-drawer';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ExternalLink, Tv, Film, Loader2, Trophy, TrendingUp, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { useExternalUrls, useExternalUrlResolver } from '@/lib/hooks/use-external-urls';
import { useMe } from '@/components/permission-provider';
import { formatAniListRankingLabel, formatFuzzyDate, isMovieFormat } from '@/lib/anilist-helpers';
import type { AniListDetailResponse, AnimeSonarrMappingItem, AnimeSonarrMappingsResponse } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import {
  getDetailViewState,
  setDetailViewState,
  waitForScrollY,
  type DetailViewKey,
} from '@/lib/detail-view-state';

type DetailWithLibrary = AniListDetailResponse & {
  library?: DiscoverLibraryStatus | null;
  libraryAvailability?: {
    radarr: 'ok' | 'unavailable';
    sonarr: 'ok' | 'unavailable';
  };
};

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
  const detailViewKey: DetailViewKey = `anime:${id}`;
  const scrollReadyRef = useRef(false);
  const hasRestoredScrollRef = useRef(false);
  // gcTime gives instant back-nav paint without the bespoke snapshot cache.
  const detailQuery = useQuery({
    queryKey: ['anime', 'detail', id],
    queryFn: async ({ signal }): Promise<DetailWithLibrary> => {
      const res = await fetch(`/api/anime/${id}`, { signal });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // ApiError so a 401 (revoked Helprr session — /api/anime serves public
        // AniList data, no AniList token involved) redirects via the global handler.
        throw new ApiError(res.status, data.error || 'Failed to load');
      }
      return res.json() as Promise<DetailWithLibrary>;
    },
    enabled: !!id,
  });
  const refetchDetail = detailQuery.refetch;
  const detail = detailQuery.data ?? null;
  const loading = detailQuery.isLoading;
  // Only block the page on an error when there's no cached detail to show — a
  // transient background-refetch failure keeps isError true but should not
  // replace already-painted content.
  const error = !detail && detailQuery.isError
    ? detailQuery.error instanceof Error
      ? detailQuery.error.message
      : 'Failed to load'
    : null;
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const externalUrls = useExternalUrls();
  const resolveExternalUrl = useExternalUrlResolver();
  const [jellyfinLoading, setJellyfinLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // AniList↔Sonarr mappings are global admin state, so the map action is admin-only.
  const isAdmin = useMe()?.role === 'admin';
  const [showSonarrMap, setShowSonarrMap] = useState(false);
  // Reverse lookup so the row shows the current mapping without opening the drawer.
  const [sonarrMappings, setSonarrMappings] = useState<AnimeSonarrMappingItem[] | null>(null);

  const detailFormat = detail?.format ?? null;
  // When the library lookup already identified the Sonarr series, pass it as a
  // hint so the reverse lookup can lazily resolve the mapping — otherwise an
  // anime whose series page was never opened reads "Not mapped" despite being
  // in the library ("Open in TV" working).
  const librarySeriesId =
    detail?.library?.exists && detail.library.type === 'series'
      ? detail.library.id ?? null
      : null;
  // The instance that holds that series — a series id is only unique within an
  // instance, so the hint must name it or the server resolves the wrong one.
  const libraryInstanceId =
    detail?.library?.exists && detail.library.type === 'series'
      ? detail.library.instanceId ?? null
      : null;
  useEffect(() => {
    setSonarrMappings(null);
    if (!isAdmin || !detailFormat || isMovieFormat(detailFormat)) return;

    const controller = new AbortController();
    const hint = librarySeriesId != null
      ? `?sonarrSeriesId=${librarySeriesId}${libraryInstanceId ? `&sonarrInstanceId=${libraryInstanceId}` : ''}`
      : '';
    fetch(`/api/anime/${id}/sonarr${hint}`, { signal: controller.signal })
      .then((r) => {
        if (r.status === 401) handleAuthError(new ApiError(401, 'Session expired'));
        return r.ok ? (r.json() as Promise<AnimeSonarrMappingsResponse>) : null;
      })
      .then((data) => {
        if (data) setSonarrMappings(data.mappings);
      })
      .catch(() => {
        // The row falls back to the bare action label.
      });

    return () => controller.abort();
  }, [id, isAdmin, detailFormat, librarySeriesId, libraryInstanceId]);

  // Reset scroll-restore guards when navigating to a different anime.
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

  useEffect(() => {
    setNowMs(Date.now());

    if (!detail?.nextAiringEpisode) return;

    const tick = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(tick);
    };
  }, [detail?.nextAiringEpisode]);

  // Refresh the detail on a 10-min interval and on focus/visibility (fresh
  // airing countdown), via the query's refetch.
  useEffect(() => {
    if (!detail) return;
    const refresh = () => { void refetchDetail(); };
    const intervalId = window.setInterval(refresh, 10 * 60 * 1000);
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'hidden') return;
      refresh();
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [detail, refetchDetail]);

  const nextAiringSeconds = detail?.nextAiringEpisode
    ? Math.max(0, detail.nextAiringEpisode.airingAt - Math.floor(nowMs / 1000))
    : null;

  if (loading && !detail) {
    return <><PageHeader title="Anime" /><PageSpinner /></>;
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
    infoRows.push({
      label: 'Studios',
      value: mainStudios.map((s) => s.name).join(', '),
      valueNode: (
        <span>
          {mainStudios.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <Link href={`/anime/studio/${s.id}`} className="text-primary hover:underline">{s.name}</Link>
            </span>
          ))}
        </span>
      ),
    });
  }
  const producers = detail.studios.filter((s) => !s.isMain);
  if (producers.length) {
    infoRows.push({
      label: 'Producers',
      value: producers.map((s) => s.name).join(', '),
      valueNode: (
        <span>
          {producers.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <Link href={`/anime/studio/${s.id}`} className="text-primary hover:underline">{s.name}</Link>
            </span>
          ))}
        </span>
      ),
    });
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
      if (res.status === 401) {
        popup.close();
        handleAuthError(new ApiError(401, 'Session expired'));
        return;
      }
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
    // A title can live in more than one instance — link to each one's web UI.
    const instances = detail.library.instances?.length
      ? detail.library.instances
      : [{ instanceId: detail.library.instanceId ?? '', instanceLabel: '', id: detail.library.id ?? 0, titleSlug: detail.library.titleSlug }];
    const multi = instances.length > 1;
    for (const inst of instances) {
      if (detail.library.type === 'series') {
        const sonarrUrl = resolveExternalUrl('SONARR', inst.instanceId);
        if (sonarrUrl && inst.titleSlug) {
          libraryLinks.push({
            label: multi ? `Open in Sonarr · ${inst.instanceLabel}` : 'Open in Sonarr',
            url: `${sonarrUrl}/series/${inst.titleSlug}`,
            icon: 'sonarr',
          });
        }
      } else if (detail.library.type === 'movie') {
        const radarrUrl = resolveExternalUrl('RADARR', inst.instanceId);
        if (radarrUrl && detail.library.tmdbId) {
          libraryLinks.push({
            label: multi ? `Open in Radarr · ${inst.instanceLabel}` : 'Open in Radarr',
            url: `${radarrUrl}/movie/${detail.library.tmdbId}`,
            icon: 'radarr',
          });
        }
      }
    }
  }

  const importantLinks = [
    { label: 'AniList', url: anilistLink },
    ...(malLink ? [{ label: 'MyAnimeList', url: malLink }] : []),
    ...detail.externalLinks
      .filter((l) => l.url)
      .map((l) => ({ label: l.site, url: l.url! })),
  ];

  return (
    <div className="animate-content-in" onClickCapture={() => setDetailViewState(detailViewKey, { scrollY: window.scrollY })}>
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
        bannerAction={
          <div className="flex gap-1.5 items-center">
            <AnimeAddButton
              title={detail.title}
              format={detail.format}
              tvdbId={detail.tvdbId}
              tmdbId={detail.tmdbId}
              library={detail.library ?? undefined}
              libraryAvailability={detail.libraryAvailability}
            />
            <WatchlistButton
              draft={{
                source: 'ANILIST',
                externalId: String(detail.id),
                mediaType: 'anime',
                title: detail.title,
                year: detail.seasonYear ?? detail.startDate?.year ?? null,
                posterUrl: detail.coverImage ?? null,
                overview: detail.description ?? null,
                rating: detail.averageScore ?? null,
                releaseDate: detail.nextAiringEpisode?.airingAt
                  ? new Date(detail.nextAiringEpisode.airingAt * 1000).toISOString()
                  : detail.startDate?.year
                    ? `${detail.startDate.year}-${String(detail.startDate.month ?? 1).padStart(2, '0')}-${String(detail.startDate.day ?? 1).padStart(2, '0')}`
                    : null,
              }}
              variant="icon"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/55 backdrop-blur-md text-foreground hover:bg-background/70"
            />
            <ScheduledAlertButton
              draft={{
                source: 'ANILIST',
                externalId: String(detail.id),
                mediaType: 'anime',
                title: detail.title,
                year: detail.seasonYear ?? detail.startDate?.year ?? null,
                posterUrl: detail.coverImage ?? null,
                overview: detail.description ?? null,
                rating: detail.averageScore ?? null,
                releaseDate: detail.nextAiringEpisode?.airingAt
                  ? new Date(detail.nextAiringEpisode.airingAt * 1000).toISOString()
                  : detail.startDate?.year
                    ? `${detail.startDate.year}-${String(detail.startDate.month ?? 1).padStart(2, '0')}-${String(detail.startDate.day ?? 1).padStart(2, '0')}`
                    : null,
                href: `/anime/${detail.id}`,
              }}
              variant="icon"
              className="h-7 w-7"
            />
          </div>
        }
        nextAiringSeconds={formatCountdown(nextAiringSeconds ?? 0)}
        nextAiringEpisode={detail.nextAiringEpisode}
      />

      <div className="space-y-5 mt-4">
        {/* Anilist update form */}
        <AnilistStatusPanel
          mediaId={detail.id}
          mediaTitle={detail.title}
          mediaType="ANIME"
          totalEpisodes={detail.episodes}
        />

        {/* Trailer */}
        <AnimeTrailerRail
          trailer={detail.trailer}
          externalLinks={detail.externalLinks}
          title={detail.title}
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

        {/* Sonarr mapping — admin-only; Sonarr only carries series, so hide for movies */}
        {isAdmin && !isMovieFormat(detail.format) && (
          <button
            onClick={() => setShowSonarrMap(true)}
            className="flex justify-between items-center w-full py-2.5 border-b border-border/30 -mx-2 px-2 rounded active:bg-muted/30"
          >
            <span className="text-sm text-muted-foreground">Sonarr</span>
            <span className="flex items-center gap-2 text-sm text-right">
              {sonarrMappings === null
                ? 'Map to Sonarr series'
                : sonarrMappings.length === 0
                  ? 'Not mapped'
                  : `Mapped · ${sonarrMappings[0].seriesTitle}${sonarrMappings.length > 1 ? ` +${sonarrMappings.length - 1}` : ''
                  }`}
              {sonarrMappings && sonarrMappings.length > 0 && (
                sonarrMappings[0].state === 'MANUAL_MATCH' ? (
                  <Badge className="bg-green-600/90 text-foreground text-[10px] px-1.5 py-0">Manual</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">Auto</Badge>
                )
              )}
              <Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
            </span>
          </button>
        )}

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
                  <Link
                    key={`${person.id}-${person.role}-${index}`}
                    href={`/anime/staff/${person.id}`}
                    className="flex items-center gap-2 bg-muted/20 rounded-lg p-2 border border-border/30 hover:border-primary/40 transition-colors"
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
                  </Link>
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
                    {' '}{formatAniListRankingLabel(ranking)}
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
              {[...scoreDistribution]
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
        <div className='md:px-2'>
          <AnimeMediaRail title="Recommendations" items={detail.recommendations} />
        </div>

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

      {isAdmin && !isMovieFormat(detail.format) && (
        <SonarrMapDrawer
          open={showSonarrMap}
          onOpenChange={setShowSonarrMap}
          anilistMediaId={detail.id}
          animeTitle={detail.title}
          sonarrSeriesHint={librarySeriesId}
          sonarrInstanceHint={libraryInstanceId}
          onMappingsChanged={setSonarrMappings}
        />
      )}
    </div>
  );
}
