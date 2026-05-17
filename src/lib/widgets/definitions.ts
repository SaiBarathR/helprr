import type { WidgetDefinition, WidgetProps, WidgetSpan } from './types';
import * as React from 'react';

// Existing widgets (refactored from dashboard)
import { StatsGridWidget } from '@/components/widgets/stats-grid-widget';
import { ProwlarrIndexersWidget } from '@/components/widgets/prowlarr-indexers-widget';
import { NowStreamingWidget } from '@/components/widgets/now-streaming-widget';
import { ContinueWatchingWidget } from '@/components/widgets/continue-watching-widget';
import { ActiveDownloadsWidget } from '@/components/widgets/active-downloads-widget';
import { RecentlyAddedWidget } from '@/components/widgets/recently-added-widget';
import { UpcomingWidget } from '@/components/widgets/upcoming-widget';

// New widgets
import { ServiceHealthWidget } from '@/components/widgets/service-health-widget';
import { TorrentWidget } from '@/components/widgets/torrent-widget';
import { WantedItemsWidget } from '@/components/widgets/wanted-items-widget';
import { NotificationsWidget } from '@/components/widgets/notifications-widget';
import { TodayCalendarWidget } from '@/components/widgets/today-calendar-widget';
import { StorageUsageWidget } from '@/components/widgets/storage-usage-widget';
import { ActivityHistoryWidget } from '@/components/widgets/activity-history-widget';
import { CleanupStatusWidget } from '@/components/widgets/cleanup-status-widget';
import { CleanupHistoryWidget } from '@/components/widgets/cleanup-history-widget';

// Prowlarr stats widgets
import { ProwlarrStatsSummaryWidget } from '@/components/widgets/prowlarr-stats-summary-widget';
import { ProwlarrResponseTimeWidget } from '@/components/widgets/prowlarr-response-time-widget';
import { ProwlarrFailureRateWidget } from '@/components/widgets/prowlarr-failure-rate-widget';
import { ProwlarrQueriesByIndexerWidget } from '@/components/widgets/prowlarr-queries-widget';
import { ProwlarrGrabsByIndexerWidget } from '@/components/widgets/prowlarr-grabs-widget';
import { ProwlarrUserAgentQueriesWidget } from '@/components/widgets/prowlarr-ua-queries-widget';
import { ProwlarrUserAgentGrabsWidget } from '@/components/widgets/prowlarr-ua-grabs-widget';

// Jellyfin stats/history widgets
import { JellyfinUserActivityWidget } from '@/components/widgets/jellyfin-user-activity-widget';
import { JellyfinPlayHistoryWidget } from '@/components/widgets/jellyfin-play-history-widget';
import { JellyfinPlaybackMethodsWidget } from '@/components/widgets/jellyfin-playback-methods-widget';
import { JellyfinTopTvShowsWidget } from '@/components/widgets/jellyfin-top-tv-shows-widget';
import { JellyfinTopMoviesWidget } from '@/components/widgets/jellyfin-top-movies-widget';
import { JellyfinTopClientsWidget } from '@/components/widgets/jellyfin-top-clients-widget';
import { JellyfinTopDevicesWidget } from '@/components/widgets/jellyfin-top-devices-widget';
import { JellyfinPlayActivityWidget } from '@/components/widgets/jellyfin-play-activity-widget';
import { JellyfinHourlyActivityWidget } from '@/components/widgets/jellyfin-hourly-activity-widget';

// Jellyfin overview widgets
import { JellyfinServerWidget } from '@/components/widgets/jellyfin-server-widget';
import { JellyfinScheduledTasksWidget } from '@/components/widgets/jellyfin-scheduled-tasks-widget';

import { AnimeCarouselWidget } from '@/components/widgets/anime-carousel-widget';
import { ANIME_CAROUSEL_MAP, DEFAULT_ANIME_CAROUSEL_ORDER } from '@/lib/anime-carousel-config';

const span = (colSpan: WidgetSpan['colSpan'], rowSpan: WidgetSpan['rowSpan']): WidgetSpan => ({
  colSpan,
  rowSpan,
});

export const ALL_WIDGET_DEFINITIONS: WidgetDefinition[] = [
  // ── Overview ──
  {
    id: 'stats-grid',
    name: 'Stats Overview',
    description: 'Movies, series, downloads, and free space at a glance',
    icon: 'BarChart3',
    category: 'overview',
    defaultDesktopSpan: span(4, 2),
    defaultMobileSpan: span(2, 1),
    component: StatsGridWidget,
  },

  // ── Downloads / service indicators ──
  {
    id: 'prowlarr-indexers',
    name: 'Prowlarr Indexers',
    description: 'Indexer count with enabled/disabled/blocked status',
    icon: 'Layers',
    category: 'downloads',
    defaultDesktopSpan: span(3, 1),
    defaultMobileSpan: span(1, 1),
    supportsNarrow: true,
    component: ProwlarrIndexersWidget,
    requiredServices: ['PROWLARR'],
  },
  {
    id: 'wanted-items',
    name: 'Wanted Items',
    description: 'Missing and cutoff unmet counts',
    icon: 'Search',
    category: 'media',
    defaultDesktopSpan: span(3, 1),
    defaultMobileSpan: span(1, 1),
    supportsNarrow: true,
    component: WantedItemsWidget,
  },
  {
    id: 'torrent-overview',
    name: 'Torrents',
    description: 'Torrent counts, transfer speeds, and rate limits',
    icon: 'HardDrive',
    category: 'downloads',
    defaultDesktopSpan: span(3, 2),
    defaultMobileSpan: span(1, 1),
    supportsNarrow: true,
    component: TorrentWidget,
    requiredServices: ['QBITTORRENT'],
  },
  // ── Streaming ──
  {
    id: 'now-streaming',
    name: 'Now Streaming',
    description: 'Active Jellyfin playback sessions',
    icon: 'MonitorPlay',
    category: 'streaming',
    defaultDesktopSpan: span(8, 2),
    defaultMobileSpan: span(2, 1),
    desktopLayout: 'carousel',
    mobileLayout: 'list',
    component: NowStreamingWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'continue-watching',
    name: 'Continue Watching',
    description: 'Resume items from Jellyfin with progress bars',
    icon: 'PlayCircle',
    category: 'streaming',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 1),
    desktopLayout: 'posters',
    mobileLayout: 'posters',
    component: ContinueWatchingWidget,
    requiredServices: ['JELLYFIN'],
  },
  // ── Downloads ──
  {
    id: 'active-downloads',
    name: 'Active Downloads',
    description: 'Current download queue with progress',
    icon: 'Download',
    category: 'downloads',
    defaultDesktopSpan: span(6, 2),
    defaultMobileSpan: span(2, 1),
    desktopLayout: 'cards',
    mobileLayout: 'list',
    component: ActiveDownloadsWidget,
  },

  // ── Media ──
  {
    id: 'recently-added',
    name: 'Recently Added',
    description: 'Latest imports from Sonarr and Radarr',
    icon: 'Clock',
    category: 'media',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 1),
    desktopLayout: 'posters',
    mobileLayout: 'posters',
    component: RecentlyAddedWidget,
  },
  {
    id: 'upcoming',
    name: 'Upcoming',
    description: 'Movies and episodes releasing in the next 14 days',
    icon: 'Calendar',
    category: 'media',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 1),
    desktopLayout: 'posters',
    mobileLayout: 'posters',
    component: UpcomingWidget,
  },
  {
    id: 'today-calendar',
    name: "Today's Calendar",
    description: 'Episodes and movies airing today',
    icon: 'CalendarDays',
    category: 'media',
    defaultDesktopSpan: span(3, 2),
    defaultMobileSpan: span(2, 1),
    component: TodayCalendarWidget,
  },
  {
    id: 'activity-history',
    name: 'Activity History',
    description: 'Recent import and grab events timeline',
    icon: 'History',
    category: 'media',
    defaultDesktopSpan: span(4, 4),
    defaultMobileSpan: span(2, 1),
    desktopLayout: 'detailed',
    mobileLayout: 'detailed',
    component: ActivityHistoryWidget,
  },

  // ── Monitoring ──
  {
    id: 'service-health',
    name: 'Service Health',
    description: 'Connection status for all configured services',
    icon: 'Activity',
    category: 'monitoring',
    defaultDesktopSpan: span(4, 3),
    defaultMobileSpan: span(1, 1),
    supportsNarrow: true,
    component: ServiceHealthWidget,
  },
  {
    id: 'storage-usage',
    name: 'Storage Usage',
    description: 'Disk space breakdown with progress bars',
    icon: 'Database',
    category: 'monitoring',
    defaultDesktopSpan: span(4, 2),
    defaultMobileSpan: span(1, 1),
    supportsNarrow: true,
    component: StorageUsageWidget,
  },
  {
    id: 'notifications',
    name: 'Recent Notifications',
    description: 'Latest push notification history',
    icon: 'Bell',
    category: 'monitoring',
    defaultDesktopSpan: span(4, 4),
    defaultMobileSpan: span(2, 1),
    component: NotificationsWidget,
  },
  {
    id: 'cleanup-status',
    name: 'Cleanup Status',
    description: 'Next-run countdowns and active strikes',
    icon: 'ShieldAlert',
    category: 'monitoring',
    defaultDesktopSpan: span(4, 3),
    defaultMobileSpan: span(2, 1),
    component: CleanupStatusWidget,
    requiredServices: ['QBITTORRENT'],
  },
  {
    id: 'cleanup-history',
    name: 'Cleanup History',
    description: 'Recent cleanup removals, dry-runs, and strikes',
    icon: 'Sparkles',
    category: 'monitoring',
    defaultDesktopSpan: span(4, 3),
    defaultMobileSpan: span(2, 1),
    component: CleanupHistoryWidget,
    requiredServices: ['QBITTORRENT'],
  },

  // ── Prowlarr Stats ──
  {
    id: 'prowlarr-stats-summary',
    name: 'Prowlarr Summary',
    description: 'Indexers, queries, grabs, and failures for the chosen window',
    icon: 'Database',
    category: 'monitoring',
    defaultDesktopSpan: span(4, 2),
    defaultMobileSpan: span(2, 1),
    component: ProwlarrStatsSummaryWidget,
    requiredServices: ['PROWLARR'],
  },
  {
    id: 'prowlarr-response-time',
    name: 'Indexer Response Time',
    description: 'Average response time per Prowlarr indexer',
    icon: 'Timer',
    category: 'monitoring',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    component: ProwlarrResponseTimeWidget,
    requiredServices: ['PROWLARR'],
  },
  {
    id: 'prowlarr-failure-rate',
    name: 'Indexer Failure Rate',
    description: 'Query failure percentage per Prowlarr indexer',
    icon: 'XCircle',
    category: 'monitoring',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    component: ProwlarrFailureRateWidget,
    requiredServices: ['PROWLARR'],
  },
  {
    id: 'prowlarr-queries-by-indexer',
    name: 'Queries by Indexer',
    description: 'Search, RSS, and auth query volume per indexer',
    icon: 'BarChart',
    category: 'monitoring',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    component: ProwlarrQueriesByIndexerWidget,
    requiredServices: ['PROWLARR'],
  },
  {
    id: 'prowlarr-grabs-by-indexer',
    name: 'Grabs by Indexer',
    description: 'Successful grabs per Prowlarr indexer',
    icon: 'Download',
    category: 'monitoring',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    component: ProwlarrGrabsByIndexerWidget,
    requiredServices: ['PROWLARR'],
  },
  {
    id: 'prowlarr-user-agent-queries',
    name: 'User Agent — Queries',
    description: 'Top 10 user agents by Prowlarr query volume',
    icon: 'Search',
    category: 'monitoring',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    component: ProwlarrUserAgentQueriesWidget,
    requiredServices: ['PROWLARR'],
  },
  {
    id: 'prowlarr-user-agent-grabs',
    name: 'User Agent — Grabs',
    description: 'Top 10 user agents by Prowlarr grab volume',
    icon: 'Tags',
    category: 'monitoring',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    component: ProwlarrUserAgentGrabsWidget,
    requiredServices: ['PROWLARR'],
  },

  // ── Jellyfin user/history/stats ──
  {
    id: 'jellyfin-user-activity',
    name: 'Jellyfin Users',
    description: 'Per-user playback summary with click-through history',
    icon: 'Users',
    category: 'streaming',
    defaultDesktopSpan: span(4, 4),
    defaultMobileSpan: span(2, 2),
    component: JellyfinUserActivityWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-play-history',
    name: 'Jellyfin Play History',
    description: 'Recent play events with date/user/type filters',
    icon: 'History',
    category: 'streaming',
    defaultDesktopSpan: span(6, 4),
    defaultMobileSpan: span(2, 2),
    component: JellyfinPlayHistoryWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-playback-methods',
    name: 'Playback Methods',
    description: 'Direct play vs. transcode breakdown',
    icon: 'PlayCircle',
    category: 'streaming',
    defaultDesktopSpan: span(4, 3),
    defaultMobileSpan: span(2, 2),
    component: JellyfinPlaybackMethodsWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-top-tv-shows',
    name: 'Top TV Shows',
    description: 'Most-watched TV shows on Jellyfin',
    icon: 'Tv',
    category: 'streaming',
    defaultDesktopSpan: span(4, 4),
    defaultMobileSpan: span(2, 2),
    component: JellyfinTopTvShowsWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-top-movies',
    name: 'Top Movies',
    description: 'Most-watched movies on Jellyfin',
    icon: 'Film',
    category: 'streaming',
    defaultDesktopSpan: span(4, 4),
    defaultMobileSpan: span(2, 2),
    component: JellyfinTopMoviesWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-top-clients',
    name: 'Top Jellyfin Clients',
    description: 'Most-used Jellyfin clients',
    icon: 'MonitorPlay',
    category: 'streaming',
    defaultDesktopSpan: span(4, 3),
    defaultMobileSpan: span(2, 2),
    component: JellyfinTopClientsWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-top-devices',
    name: 'Top Jellyfin Devices',
    description: 'Most-used playback devices',
    icon: 'HardDrive',
    category: 'streaming',
    defaultDesktopSpan: span(4, 3),
    defaultMobileSpan: span(2, 2),
    component: JellyfinTopDevicesWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-play-activity',
    name: 'Play Activity',
    description: 'Daily/weekly playback trend',
    icon: 'BarChart3',
    category: 'streaming',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    component: JellyfinPlayActivityWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-hourly-activity',
    name: 'Hourly Activity',
    description: 'Heatmap of playback by hour and weekday',
    icon: 'Clock',
    category: 'streaming',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    component: JellyfinHourlyActivityWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-server',
    name: 'Jellyfin Server',
    description: 'Server status with Scan, Restart, and Shutdown controls',
    icon: 'Server',
    category: 'streaming',
    defaultDesktopSpan: span(4, 2),
    defaultMobileSpan: span(2, 2),
    component: JellyfinServerWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-scheduled-tasks',
    name: 'Scheduled Tasks',
    description: 'Jellyfin scheduled tasks with start/stop controls',
    icon: 'Timer',
    category: 'streaming',
    defaultDesktopSpan: span(6, 4),
    defaultMobileSpan: span(2, 3),
    component: JellyfinScheduledTasksWidget,
    requiredServices: ['JELLYFIN'],
  },
];

// Dynamically add anime carousel widgets — full-width carousels
for (const id of DEFAULT_ANIME_CAROUSEL_ORDER) {
  const config = ANIME_CAROUSEL_MAP[id];
  ALL_WIDGET_DEFINITIONS.push({
    id: `anime-${id}`,
    name: `Anime - ${config.label}`,
    description: `Anime carousel: ${config.label}`,
    icon: 'PlayCircle',
    category: 'media',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 1),
    desktopLayout: 'carousel',
    mobileLayout: 'carousel',
    component: (props: WidgetProps) =>
      React.createElement(AnimeCarouselWidget, { carouselId: id, ...props }),
  } as WidgetDefinition);
}
