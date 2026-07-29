'use client';

import { createElement, lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  DEFAULT_ANIME_CAROUSEL_ORDER,
  type AnimeCarouselId,
} from '@/lib/anime-carousel-config';
import { SETTINGS_SHORTCUTS, type SettingsShortcut } from '@/lib/widgets/settings-shortcuts';
import type { WidgetProps } from '@/lib/widgets/types';

type WidgetComponent = ComponentType<WidgetProps>;
type WidgetModule = { default: WidgetComponent };
type WidgetLoader = () => Promise<WidgetModule>;

function asWidgetModule(component: WidgetComponent): WidgetModule {
  return { default: component };
}

const widgetLoaders: Record<string, WidgetLoader> = {
  'stats-grid': () =>
    import('./stats-grid-widget').then(({ StatsGridWidget }) => asWidgetModule(StatsGridWidget)),
  'prowlarr-indexers': () =>
    import('./prowlarr-indexers-widget').then(({ ProwlarrIndexersWidget }) =>
      asWidgetModule(ProwlarrIndexersWidget)),
  'wanted-items': () =>
    import('./wanted-items-widget').then(({ WantedItemsWidget }) => asWidgetModule(WantedItemsWidget)),
  'torrent-overview': () =>
    import('./torrent-widget').then(({ TorrentWidget }) => asWidgetModule(TorrentWidget)),
  'now-streaming': () =>
    import('./now-streaming-widget').then(({ NowStreamingWidget }) => asWidgetModule(NowStreamingWidget)),
  'continue-watching': () =>
    import('./continue-watching-widget').then(({ ContinueWatchingWidget }) =>
      asWidgetModule(ContinueWatchingWidget)),
  'active-downloads': () =>
    import('./active-downloads-widget').then(({ ActiveDownloadsWidget }) =>
      asWidgetModule(ActiveDownloadsWidget)),
  'recently-added': () =>
    import('./recently-added-widget').then(({ RecentlyAddedWidget }) =>
      asWidgetModule(RecentlyAddedWidget)),
  'for-you': () =>
    import('./for-you-widget').then(({ ForYouWidget }) => asWidgetModule(ForYouWidget)),
  upcoming: () =>
    import('./upcoming-widget').then(({ UpcomingWidget }) => asWidgetModule(UpcomingWidget)),
  'today-calendar': () =>
    import('./today-calendar-widget').then(({ TodayCalendarWidget }) =>
      asWidgetModule(TodayCalendarWidget)),
  'activity-history': () =>
    import('./activity-history-widget').then(({ ActivityHistoryWidget }) =>
      asWidgetModule(ActivityHistoryWidget)),
  'service-health': () =>
    import('./service-health-widget').then(({ ServiceHealthWidget }) =>
      asWidgetModule(ServiceHealthWidget)),
  'storage-usage': () =>
    import('./storage-usage-widget').then(({ StorageUsageWidget }) =>
      asWidgetModule(StorageUsageWidget)),
  notifications: () =>
    import('./notifications-widget').then(({ NotificationsWidget }) =>
      asWidgetModule(NotificationsWidget)),
  'cleanup-status': () =>
    import('./cleanup-status-widget').then(({ CleanupStatusWidget }) =>
      asWidgetModule(CleanupStatusWidget)),
  'cleanup-history': () =>
    import('./cleanup-history-widget').then(({ CleanupHistoryWidget }) =>
      asWidgetModule(CleanupHistoryWidget)),
  'prowlarr-stats-summary': () =>
    import('./prowlarr-stats-summary-widget').then(({ ProwlarrStatsSummaryWidget }) =>
      asWidgetModule(ProwlarrStatsSummaryWidget)),
  'prowlarr-response-time': () =>
    import('./prowlarr-response-time-widget').then(({ ProwlarrResponseTimeWidget }) =>
      asWidgetModule(ProwlarrResponseTimeWidget)),
  'prowlarr-failure-rate': () =>
    import('./prowlarr-failure-rate-widget').then(({ ProwlarrFailureRateWidget }) =>
      asWidgetModule(ProwlarrFailureRateWidget)),
  'prowlarr-queries-by-indexer': () =>
    import('./prowlarr-queries-widget').then(({ ProwlarrQueriesByIndexerWidget }) =>
      asWidgetModule(ProwlarrQueriesByIndexerWidget)),
  'prowlarr-grabs-by-indexer': () =>
    import('./prowlarr-grabs-widget').then(({ ProwlarrGrabsByIndexerWidget }) =>
      asWidgetModule(ProwlarrGrabsByIndexerWidget)),
  'prowlarr-user-agent-queries': () =>
    import('./prowlarr-ua-queries-widget').then(({ ProwlarrUserAgentQueriesWidget }) =>
      asWidgetModule(ProwlarrUserAgentQueriesWidget)),
  'prowlarr-user-agent-grabs': () =>
    import('./prowlarr-ua-grabs-widget').then(({ ProwlarrUserAgentGrabsWidget }) =>
      asWidgetModule(ProwlarrUserAgentGrabsWidget)),
  'jellyfin-user-activity': () =>
    import('./jellyfin-user-activity-widget').then(({ JellyfinUserActivityWidget }) =>
      asWidgetModule(JellyfinUserActivityWidget)),
  'jellyfin-play-history': () =>
    import('./jellyfin-play-history-widget').then(({ JellyfinPlayHistoryWidget }) =>
      asWidgetModule(JellyfinPlayHistoryWidget)),
  'jellyfin-playback-methods': () =>
    import('./jellyfin-playback-methods-widget').then(({ JellyfinPlaybackMethodsWidget }) =>
      asWidgetModule(JellyfinPlaybackMethodsWidget)),
  'jellyfin-top-tv-shows': () =>
    import('./jellyfin-top-tv-shows-widget').then(({ JellyfinTopTvShowsWidget }) =>
      asWidgetModule(JellyfinTopTvShowsWidget)),
  'jellyfin-top-movies': () =>
    import('./jellyfin-top-movies-widget').then(({ JellyfinTopMoviesWidget }) =>
      asWidgetModule(JellyfinTopMoviesWidget)),
  'jellyfin-top-clients': () =>
    import('./jellyfin-top-clients-widget').then(({ JellyfinTopClientsWidget }) =>
      asWidgetModule(JellyfinTopClientsWidget)),
  'jellyfin-top-devices': () =>
    import('./jellyfin-top-devices-widget').then(({ JellyfinTopDevicesWidget }) =>
      asWidgetModule(JellyfinTopDevicesWidget)),
  'jellyfin-play-activity': () =>
    import('./jellyfin-play-activity-widget').then(({ JellyfinPlayActivityWidget }) =>
      asWidgetModule(JellyfinPlayActivityWidget)),
  'jellyfin-hourly-activity': () =>
    import('./jellyfin-hourly-activity-widget').then(({ JellyfinHourlyActivityWidget }) =>
      asWidgetModule(JellyfinHourlyActivityWidget)),
  'jellyfin-server': () =>
    import('./jellyfin-server-widget').then(({ JellyfinServerWidget }) =>
      asWidgetModule(JellyfinServerWidget)),
  'jellyfin-scheduled-tasks': () =>
    import('./jellyfin-scheduled-tasks-widget').then(({ JellyfinScheduledTasksWidget }) =>
      asWidgetModule(JellyfinScheduledTasksWidget)),
  'jellyfin-devices': () =>
    import('./jellyfin-devices-widget').then(({ JellyfinDevicesWidget }) =>
      asWidgetModule(JellyfinDevicesWidget)),
  'jellyfin-activity': () =>
    import('./jellyfin-activity-widget').then(({ JellyfinActivityWidget }) =>
      asWidgetModule(JellyfinActivityWidget)),
  'jellyfin-alerts': () =>
    import('./jellyfin-alerts-widget').then(({ JellyfinAlertsWidget }) =>
      asWidgetModule(JellyfinAlertsWidget)),
  'seerr-pending-requests': () =>
    import('./requests-list-widget').then(({ RequestsListWidget }) =>
      asWidgetModule((props) => createElement(RequestsListWidget, { filter: 'pending', ...props }))),
  'seerr-recent-requests': () =>
    import('./requests-list-widget').then(({ RequestsListWidget }) =>
      asWidgetModule((props) => createElement(RequestsListWidget, { filter: 'all', ...props }))),
  'seerr-users': () =>
    import('./requests-users-widget').then(({ RequestsUsersWidget }) =>
      asWidgetModule(RequestsUsersWidget)),
  'library-growth': () =>
    import('./library-growth-widget').then(({ LibraryGrowthWidget }) =>
      asWidgetModule(LibraryGrowthWidget)),
  'library-completeness': () =>
    import('./library-completeness-widget').then(({ LibraryCompletenessWidget }) =>
      asWidgetModule(LibraryCompletenessWidget)),
  'download-reliability': () =>
    import('./download-reliability-widget').then(({ DownloadReliabilityWidget }) =>
      asWidgetModule(DownloadReliabilityWidget)),
  'download-pipeline': () =>
    import('./download-pipeline-widget').then(({ DownloadPipelineWidget }) =>
      asWidgetModule(DownloadPipelineWidget)),
  'storage-breakdown': () =>
    import('./storage-breakdown-widget').then(({ StorageBreakdownWidget }) =>
      asWidgetModule(StorageBreakdownWidget)),
  'seeding-economics': () =>
    import('./seeding-economics-widget').then(({ SeedingEconomicsWidget }) =>
      asWidgetModule(SeedingEconomicsWidget)),
  'media-technical-breakdown': () =>
    import('./media-technical-breakdown-widget').then(({ MediaTechnicalBreakdownWidget }) =>
      asWidgetModule(MediaTechnicalBreakdownWidget)),
  'media-quality-scores': () =>
    import('./media-quality-scores-widget').then(({ MediaQualityScoresWidget }) =>
      asWidgetModule(MediaQualityScoresWidget)),
  watchlist: () =>
    import('./watchlist-widget').then(({ WatchlistWidget }) => asWidgetModule(WatchlistWidget)),
  'library-gaps': () =>
    import('./library-gaps-widget').then(({ LibraryGapsWidget }) =>
      asWidgetModule(LibraryGapsWidget)),
  'random-watch': () =>
    import('./random-watch-widget').then(({ RandomWatchWidget }) =>
      asWidgetModule(RandomWatchWidget)),
};

function settingsLoader(shortcut: SettingsShortcut): WidgetLoader {
  return () =>
    import('./settings-shortcut-widget').then(({ SettingsShortcutWidget }) =>
      asWidgetModule((props) => createElement(SettingsShortcutWidget, { shortcut, ...props })));
}

function animeLoader(carouselId: AnimeCarouselId): WidgetLoader {
  return () =>
    import('./anime-carousel-widget').then(({ AnimeCarouselWidget }) =>
      asWidgetModule((props) => createElement(AnimeCarouselWidget, { carouselId, ...props })));
}

for (const shortcut of SETTINGS_SHORTCUTS) {
  widgetLoaders[`settings-${shortcut.key}`] = settingsLoader(shortcut);
}

for (const carouselId of DEFAULT_ANIME_CAROUSEL_ORDER) {
  widgetLoaders[`anime-${carouselId}`] = animeLoader(carouselId);
}

export const STATIC_WIDGET_LOADER_IDS = Object.freeze(Object.keys(widgetLoaders));

const componentCache = new Map<string, LazyExoticComponent<WidgetComponent>>();

export function getWidgetComponent(widgetId: string): LazyExoticComponent<WidgetComponent> | undefined {
  const cached = componentCache.get(widgetId);
  if (cached) return cached;

  let loader = widgetLoaders[widgetId];
  if (!loader && widgetId.startsWith('discover-')) {
    const sectionId = widgetId.slice('discover-'.length);
    if (!sectionId) return undefined;
    loader = () =>
      import('./discover-section-widget').then(({ DiscoverSectionWidget }) =>
        asWidgetModule((props) => createElement(DiscoverSectionWidget, { sectionId, ...props })));
  }
  if (!loader) return undefined;

  const component = lazy(loader);
  componentCache.set(widgetId, component);
  return component;
}

export function resetWidgetComponent(widgetId: string): void {
  componentCache.delete(widgetId);
}
