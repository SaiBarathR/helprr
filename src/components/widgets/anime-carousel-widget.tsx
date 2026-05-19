'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { toCachedImageSrc } from '@/lib/image';
import type { AnimeCarouselId } from '@/lib/anime-carousel-config';
import type { AniListMediaListCollection, AniListMediaListEntry } from '@/lib/anilist-mutations';
import type { AniListMediaSeason, AniListListItem } from '@/types/anilist';
import type { WidgetProps } from '@/lib/widgets/types';
import {
  CAROUSEL_CARD_HEIGHT,
  CAROUSEL_CARD_WIDTH,
  CAROUSEL_GAP,
  FONT_MONO,
  HPR,
  LIST_ROW_HEIGHT,
  Poster,
  SectionHeader,
  ViewModeToggle,
  toneFromString,
} from './bento-primitives';
import { useDashboardLayout } from './dashboard-layout-context';

interface SeasonWindow {
  season: AniListMediaSeason;
  year: number;
}

interface HomeData {
  currentSeason: SeasonWindow;
  nextSeasonInfo: SeasonWindow;
  trending: AniListListItem[];
  season: AniListListItem[];
  nextSeason: AniListListItem[];
  popular: AniListListItem[];
  top: AniListListItem[];
}

interface AnimeCarouselWidgetProps extends WidgetProps {
  carouselId: AnimeCarouselId;
}

interface RailItem {
  id: number;
  title: string;
  coverImage: string | null;
  format: string | null;
  averageScore: number | null;
  episodes: number | null;
  seasonYear: number | null;
}

function entryToRailItem(entry: AniListMediaListEntry): RailItem {
  const media = entry.media;
  const title = media.title.english || media.title.romaji || media.title.native || `#${media.id}`;
  const cover =
    media.coverImage?.large || media.coverImage?.medium || media.coverImage?.extraLarge || null;
  return {
    id: media.id,
    title,
    coverImage: cover,
    format: (media.format as string) ?? null,
    averageScore: media.averageScore,
    episodes: media.episodes ?? null,
    seasonYear: media.seasonYear ?? null,
  };
}

function itemToRailItem(item: AniListListItem): RailItem {
  return {
    id: item.id,
    title: item.title || item.titleRomaji || item.titleNative || `#${item.id}`,
    coverImage: item.coverImage || null,
    format: (item.format as string) ?? null,
    averageScore: item.averageScore,
    episodes: item.episodes ?? null,
    seasonYear: item.seasonYear ?? null,
  };
}

const HOME_CACHE_TTL_MS = 5 * 60 * 1000;
const ANILIST_MAX_PER_PAGE = 50;
const homeDataPromises = new Map<number, { promise: Promise<HomeData>; time: number }>();

async function fetchHomeDataCached(perPage: number) {
  const clamped = Math.min(ANILIST_MAX_PER_PAGE, Math.max(10, perPage));
  const now = Date.now();
  const existing = homeDataPromises.get(clamped);
  if (existing && now - existing.time < HOME_CACHE_TTL_MS) {
    return existing.promise;
  }
  const promise = fetch(`/api/anime/home?perPage=${clamped}`)
    .then((res) => {
      if (!res.ok) throw new Error('Failed to fetch anime home data');
      return res.json() as Promise<HomeData>;
    })
    .catch((error) => {
      homeDataPromises.delete(clamped);
      throw error;
    });
  homeDataPromises.set(clamped, { promise, time: now });
  return promise;
}

function flattenEntries(collection: AniListMediaListCollection): AniListMediaListEntry[] {
  const seen = new Set<number>();
  const result: AniListMediaListEntry[] = [];
  for (const list of collection.lists) {
    for (const entry of list.entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      result.push(entry);
    }
  }
  return result;
}

export function AnimeCarouselWidget({
  carouselId,
  refreshInterval,
  editMode,
  narrow,
  layoutVariant,
  instanceId,
  mobileGrid = false,
}: AnimeCarouselWidgetProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const { setWidgetLayoutOverride } = useDashboardLayout();
  const useList = !!narrow || layoutVariant === 'list';
  const { visibleCount: listVisible, fetchSize } = useListFetchSize({
    height,
    rowHeight: LIST_ROW_HEIGHT,
  });
  const carouselVisible = width > 0
    ? Math.ceil(width / (CAROUSEL_CARD_WIDTH + CAROUSEL_GAP)) + 4
    : narrow ? 8 : 12;
  const visibleCount = Math.max(listVisible, carouselVisible);
  const perPage = Math.min(ANILIST_MAX_PER_PAGE, Math.max(visibleCount, fetchSize));
  const toggleNode = !narrow && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next, { mobile: mobileGrid })}
    />
  ) : null;
  const requiresViewer = carouselId === 'continueWatching' || carouselId === 'planToWatch';
  const [viewerConnected, setViewerConnected] = useState<boolean | null>(null);
  const ready = requiresViewer ? viewerConnected === true : true;

  useEffect(() => {
    if (!requiresViewer) return;
    fetch('/api/anilist/viewer')
      .then((res) => res.json())
      .then((data) => setViewerConnected(!!data.connected))
      .catch(() => setViewerConnected(false));
  }, [requiresViewer]);

  const { data: homeData, loading: homeLoading } = useWidgetData<HomeData>({
    fetchFn: () => fetchHomeDataCached(perPage),
    refreshInterval,
    enabled: !editMode && !requiresViewer && ready,
    cacheKey: `anime-home-${perPage}`,
  });

  const { data: listData, loading: listLoading } = useWidgetData<AniListMediaListEntry[]>({
    fetchFn: async () => {
      const status = carouselId === 'continueWatching' ? 'CURRENT' : 'PLANNING';
      const res = await fetch(`/api/anilist/library?type=ANIME&status=${status}`);
      if (!res.ok) throw new Error(`Failed to fetch ${status} list`);
      const json = await res.json();
      return flattenEntries(json.collection);
    },
    refreshInterval,
    enabled: !editMode && requiresViewer && ready,
    cacheKey: `anime-${carouselId}`,
  });

  let title = '';
  let viewAllHref = '';
  if (carouselId === 'continueWatching') {
    title = 'Continue Watching';
    viewAllHref = '/anime/library?status=CURRENT';
  } else if (carouselId === 'planToWatch') {
    title = 'Plan to Watch';
    viewAllHref = '/anime/library?status=PLANNING';
  } else if (carouselId === 'trending') {
    title = 'Trending Anime';
    viewAllHref = '/anime/explore?sort=trending';
  } else if (carouselId === 'popularThisSeason') {
    title = 'Popular This Season';
    viewAllHref = homeData?.currentSeason
      ? `/anime/explore?sort=seasonal&season=${homeData.currentSeason.season}&year=${homeData.currentSeason.year}`
      : '/anime/explore?sort=seasonal';
  } else if (carouselId === 'upcomingNextSeason') {
    title = 'Upcoming Next Season';
    viewAllHref = homeData?.nextSeasonInfo
      ? `/anime/explore?sort=seasonal&season=${homeData.nextSeasonInfo.season}&year=${homeData.nextSeasonInfo.year}`
      : '/anime/explore?sort=seasonal';
  } else if (carouselId === 'allTimePopular') {
    title = 'All Time Popular';
    viewAllHref = '/anime/explore?sort=popularity';
  } else if (carouselId === 'top100') {
    title = 'Top 100 Anime';
    viewAllHref = '/anime/explore?sort=score';
  }

  if (viewerConnected === false) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title={title} right={toggleNode} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
          Connect AniList in Settings to enable this list.
        </div>
      </div>
    );
  }

  // The viewer probe is async — while it's pending, treat the widget as
  // loading so we don't flash the empty "No items" state before listData
  // even has a chance to fetch.
  const viewerPending = requiresViewer && viewerConnected === null;
  const loading = viewerPending || (requiresViewer ? listLoading : homeLoading);

  let items: RailItem[] = [];
  if (requiresViewer) items = (listData ?? []).map(entryToRailItem);
  else if (homeData) {
    if (carouselId === 'trending') items = homeData.trending.map(itemToRailItem);
    else if (carouselId === 'popularThisSeason') items = homeData.season.map(itemToRailItem);
    else if (carouselId === 'upcomingNextSeason') items = homeData.nextSeason.map(itemToRailItem);
    else if (carouselId === 'allTimePopular') items = homeData.popular.map(itemToRailItem);
    else if (carouselId === 'top100') items = homeData.top.map(itemToRailItem);
  }

  if (loading && items.length === 0) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title={title} right={toggleNode} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title={title} right={toggleNode} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>No items</div>
      </div>
    );
  }

  if (useList) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader
          title={title}
          right={
            <>
              {toggleNode}
              <Link href={viewAllHref} style={{ color: HPR.fgMute, textDecoration: 'none' }}>
                View all →
              </Link>
            </>
          }
        />
        <div
          className="no-scrollbar scroll-fade-y"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          {items.slice(0, visibleCount).map((it) => {
            const isManga = it.format === 'MANGA' || it.format === 'NOVEL' || it.format === 'ONE_SHOT';
            const href = isManga ? `/anime/manga/${it.id}` : `/anime/${it.id}`;
            const imgSrc = it.coverImage
              ? toCachedImageSrc(it.coverImage, 'anilist') || it.coverImage
              : null;
            const meta = [
              it.format?.replace('_', ' '),
              it.episodes != null ? `${it.episodes} eps` : null,
              it.seasonYear != null ? String(it.seasonYear) : null,
            ]
              .filter(Boolean)
              .join(' · ');
            const row = (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: 8,
                  background: HPR.ink,
                  borderRadius: 12,
                }}
              >
                <Poster
                  width={48}
                  height={72}
                  label={it.title}
                  tone={toneFromString(it.title)}
                  fontSize={8}
                  imageUrl={imgSrc ?? undefined}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      color: HPR.fg,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontWeight: 500,
                    }}
                  >
                    {it.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: HPR.fgMute,
                      fontFamily: FONT_MONO,
                      marginTop: 2,
                      wordBreak: 'break-word',
                    }}
                  >
                    {meta}
                  </div>
                </div>
                {it.averageScore != null && (
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: HPR.amber,
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    ★ {it.averageScore}%
                  </span>
                )}
              </div>
            );
            return editMode ? (
              <div key={it.id}>{row}</div>
            ) : (
              <Link
                key={it.id}
                href={href}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                {row}
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref}>
      <SectionHeader
        title={title}
        right={
          <>
            {toggleNode}
            <Link href={viewAllHref} style={{ color: HPR.fgMute, textDecoration: 'none' }}>
              View all →
            </Link>
          </>
        }
      />
      <div
        className="no-scrollbar"
        style={{ display: 'flex', gap: CAROUSEL_GAP, overflowX: 'auto', paddingBottom: 4 }}
      >
        {items.slice(0, visibleCount).map((it) => {
          const imgSrc = it.coverImage ? toCachedImageSrc(it.coverImage, 'anilist') || it.coverImage : null;
          const isManga = it.format === 'MANGA' || it.format === 'NOVEL' || it.format === 'ONE_SHOT';
          const href = isManga ? `/anime/manga/${it.id}` : `/anime/${it.id}`;
          const meta = [
            it.format?.replace('_', ' '),
            it.episodes != null ? `${it.episodes} eps` : null,
            it.seasonYear != null ? String(it.seasonYear) : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const card = (
            <>
              <Poster
                width={CAROUSEL_CARD_WIDTH}
                height={CAROUSEL_CARD_HEIGHT}
                label={it.title}
                tone={toneFromString(it.title)}
                imageUrl={imgSrc ?? undefined}
                rating={it.averageScore ? `${it.averageScore}%` : null}
              />
              <div
                style={{
                  fontSize: 11,
                  color: HPR.fg,
                  marginTop: 6,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontWeight: 500,
                }}
              >
                {it.title}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: HPR.fgMute,
                  fontFamily: FONT_MONO,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {meta}
              </div>
            </>
          );
          return editMode ? (
            <div key={it.id} style={{ width: CAROUSEL_CARD_WIDTH, flexShrink: 0 }}>
              {card}
            </div>
          ) : (
            <Link
              key={it.id}
              href={href}
              style={{
                width: CAROUSEL_CARD_WIDTH,
                flexShrink: 0,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              {card}
            </Link>
          );
        })}
        {!editMode && (
          <Link
            href={viewAllHref}
            style={{
              alignSelf: 'center',
              padding: '6px 10px',
              borderRadius: 999,
              border: `1px solid ${HPR.hairline2}`,
              fontSize: 11,
              color: HPR.fg,
              textDecoration: 'none',
              flexShrink: 0,
              fontFamily: FONT_MONO,
            }}
          >
            See all →
          </Link>
        )}
      </div>
    </div>
  );
}
