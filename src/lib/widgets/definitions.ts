import type { WidgetDefinition, WidgetProps, WidgetSpan } from './types';
import type { Capability } from '@/lib/capabilities';
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
import { JellyfinDevicesWidget } from '@/components/widgets/jellyfin-devices-widget';
import { JellyfinActivityWidget } from '@/components/widgets/jellyfin-activity-widget';
import { JellyfinAlertsWidget } from '@/components/widgets/jellyfin-alerts-widget';

// Seerr widgets
import { RequestsListWidget } from '@/components/widgets/requests-list-widget';
import { RequestsUsersWidget } from '@/components/widgets/requests-users-widget';

import { AnimeCarouselWidget } from '@/components/widgets/anime-carousel-widget';
import { ANIME_CAROUSEL_MAP, DEFAULT_ANIME_CAROUSEL_ORDER } from '@/lib/anime-carousel-config';

// For You recommendations
import { ForYouWidget } from '@/components/widgets/for-you-widget';

// Insights-derived analytics widgets
import { LibraryGrowthWidget } from '@/components/widgets/library-growth-widget';
import { LibraryCompletenessWidget } from '@/components/widgets/library-completeness-widget';
import { DownloadReliabilityWidget } from '@/components/widgets/download-reliability-widget';
import { DownloadPipelineWidget } from '@/components/widgets/download-pipeline-widget';
import { StorageBreakdownWidget } from '@/components/widgets/storage-breakdown-widget';
import { SeedingEconomicsWidget } from '@/components/widgets/seeding-economics-widget';
import { MediaTechnicalBreakdownWidget } from '@/components/widgets/media-technical-breakdown-widget';
import { MediaQualityScoresWidget } from '@/components/widgets/media-quality-scores-widget';

// Page features surfaced as widgets
import { WatchlistWidget } from '@/components/widgets/watchlist-widget';
import { LibraryGapsWidget } from '@/components/widgets/library-gaps-widget';
import { RandomWatchWidget } from '@/components/widgets/random-watch-widget';
import { SettingsShortcutWidget } from '@/components/widgets/settings-shortcut-widget';
import { SETTINGS_SHORTCUTS } from '@/lib/widgets/settings-shortcuts';

const span = (colSpan: WidgetSpan['colSpan'], rowSpan: WidgetSpan['rowSpan']): WidgetSpan => ({
  colSpan,
  rowSpan,
});

// Minimum/maximum allowed refresh interval (seconds) for per-instance overrides.
export const WIDGET_REFRESH_MIN_SECS = 10;
export const WIDGET_REFRESH_MAX_SECS = 300;

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
    defaultRefreshIntervalSecs: 30,
    desktopLayout: 'default',
    mobileLayout: 'vertical',
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
    defaultRefreshIntervalSecs: 30,
    supportsNarrow: true,
    desktopLayout: 'default',
    mobileLayout: 'vertical',
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
    defaultRefreshIntervalSecs: 30,
    supportsNarrow: true,
    desktopLayout: 'default',
    mobileLayout: 'vertical',
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
    defaultRefreshIntervalSecs: 15,
    supportsNarrow: true,
    desktopLayout: 'default',
    mobileLayout: 'vertical',
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
    defaultRefreshIntervalSecs: 15,
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
    defaultRefreshIntervalSecs: 30,
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
    defaultRefreshIntervalSecs: 15,
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
    defaultRefreshIntervalSecs: 60,
    desktopLayout: 'posters',
    mobileLayout: 'posters',
    component: RecentlyAddedWidget,
  },
  {
    id: 'for-you',
    name: 'For You',
    description: 'Recommendations based on what you recently added',
    icon: 'Sparkles',
    category: 'discover',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 1),
    defaultRefreshIntervalSecs: 300,
    desktopLayout: 'carousel',
    mobileLayout: 'carousel',
    component: ForYouWidget,
    requiredServices: ['TMDB'],
  },
  {
    id: 'upcoming',
    name: 'Upcoming',
    description: 'Movies and episodes releasing in the next 14 days',
    icon: 'Calendar',
    category: 'media',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 1),
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 30,
    desktopLayout: 'list',
    mobileLayout: 'list',
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 30,
    supportsNarrow: true,
    desktopLayout: 'default',
    mobileLayout: 'vertical',
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
    defaultRefreshIntervalSecs: 30,
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
    defaultRefreshIntervalSecs: 30,
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
    defaultRefreshIntervalSecs: 30,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 60,
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
    defaultRefreshIntervalSecs: 30,
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
    defaultRefreshIntervalSecs: 30,
    component: JellyfinScheduledTasksWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-devices',
    name: 'Jellyfin Devices',
    description: 'Registered Jellyfin devices with last-active times',
    icon: 'MonitorSmartphone',
    category: 'streaming',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 60,
    desktopLayout: 'carousel',
    mobileLayout: 'list',
    component: JellyfinDevicesWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-activity',
    name: 'Jellyfin Activity',
    description: 'Recent server activity — sign-ins, sessions, and connections',
    icon: 'Activity',
    category: 'streaming',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 30,
    desktopLayout: 'carousel',
    mobileLayout: 'list',
    component: JellyfinActivityWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'jellyfin-alerts',
    name: 'Jellyfin Alerts',
    description: 'Failed logins and error-severity server events',
    icon: 'ShieldAlert',
    category: 'streaming',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 30,
    desktopLayout: 'carousel',
    mobileLayout: 'list',
    component: JellyfinAlertsWidget,
    requiredServices: ['JELLYFIN'],
  },

  // ── Seerr (requests) ──
  {
    id: 'seerr-pending-requests',
    name: 'Pending Requests',
    description: 'Pending Seerr requests with approve/decline actions',
    icon: 'Inbox',
    category: 'monitoring',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 60,
    component: (props: WidgetProps) =>
      React.createElement(RequestsListWidget, { filter: 'pending', ...props }),
    requiredServices: ['SEERR'],
  },
  {
    id: 'seerr-recent-requests',
    name: 'Recent Requests',
    description: 'All Seerr requests, newest first',
    icon: 'List',
    category: 'monitoring',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 60,
    component: (props: WidgetProps) =>
      React.createElement(RequestsListWidget, { filter: 'all', ...props }),
    requiredServices: ['SEERR'],
  },
  {
    id: 'seerr-users',
    name: 'Seerr Users',
    description: 'Seerr users with request counts and quotas',
    icon: 'Users',
    category: 'monitoring',
    defaultDesktopSpan: span(4, 3),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 120,
    component: RequestsUsersWidget,
    requiredServices: ['SEERR'],
  },

  // ── Insights analytics ──
  {
    id: 'library-growth',
    name: 'Library Growth',
    description: 'Movies, series, and music added over time',
    icon: 'BarChart3',
    category: 'media',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 300,
    component: LibraryGrowthWidget,
  },
  {
    id: 'library-completeness',
    name: 'Library Completeness',
    description: 'Overall completeness with overdue, missing, and gap counts',
    icon: 'Layers',
    category: 'media',
    defaultDesktopSpan: span(4, 3),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 300,
    component: LibraryCompletenessWidget,
  },
  {
    id: 'download-reliability',
    name: 'Download Reliability',
    description: 'Grabbed / imported / failed success rate over the window',
    icon: 'Activity',
    category: 'downloads',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 300,
    component: DownloadReliabilityWidget,
  },
  {
    id: 'download-pipeline',
    name: 'Download Pipeline',
    description: 'Grab→import latency, hourly activity, indexers, and release groups',
    icon: 'Timer',
    category: 'downloads',
    defaultDesktopSpan: span(6, 4),
    defaultMobileSpan: span(2, 3),
    defaultRefreshIntervalSecs: 300,
    component: DownloadPipelineWidget,
  },
  {
    id: 'storage-breakdown',
    name: 'Storage Breakdown',
    description: 'Library size by type with the largest items',
    icon: 'HardDrive',
    category: 'monitoring',
    defaultDesktopSpan: span(4, 4),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 300,
    component: StorageBreakdownWidget,
  },
  {
    id: 'seeding-economics',
    name: 'Seeding Economics',
    description: 'Upload totals, ratio, and top seeding torrents',
    icon: 'Database',
    category: 'monitoring',
    defaultDesktopSpan: span(4, 3),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 120,
    component: SeedingEconomicsWidget,
    requiredServices: ['QBITTORRENT'],
  },
  {
    id: 'media-technical-breakdown',
    name: 'Technical Breakdown',
    description: 'Codec, resolution, HDR, and audio distribution of your files',
    icon: 'Film',
    category: 'monitoring',
    defaultDesktopSpan: span(8, 4),
    defaultMobileSpan: span(2, 3),
    defaultRefreshIntervalSecs: 300,
    component: MediaTechnicalBreakdownWidget,
  },
  {
    id: 'media-quality-scores',
    name: 'Quality Scores',
    description: 'Average quality score, histogram, and upgrade candidates',
    icon: 'Sparkles',
    category: 'monitoring',
    defaultDesktopSpan: span(6, 4),
    defaultMobileSpan: span(2, 3),
    defaultRefreshIntervalSecs: 300,
    component: MediaQualityScoresWidget,
  },

  // ── Page features as widgets ──
  {
    id: 'watchlist',
    name: 'Watchlist',
    description: 'Your saved titles, newest first — poster rail or list',
    icon: 'Bookmark',
    category: 'media',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 120,
    supportsNarrow: true,
    desktopLayout: 'posters',
    mobileLayout: 'list',
    component: WatchlistWidget,
  },
  {
    id: 'library-gaps',
    name: 'Library Gaps',
    description: 'Missing seasons, collection gaps, and overdue items',
    icon: 'SearchX',
    category: 'media',
    defaultDesktopSpan: span(6, 3),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 300,
    component: LibraryGapsWidget,
  },
  {
    id: 'random-watch',
    name: 'Random Pick',
    description: 'A random downloaded title with a reroll button',
    icon: 'Dices',
    category: 'discover',
    defaultDesktopSpan: span(4, 2),
    defaultMobileSpan: span(2, 2),
    defaultRefreshIntervalSecs: 300,
    supportsNarrow: true,
    component: RandomWatchWidget,
  },
];

// Dynamically add settings launcher tiles — one 1×1 shortcut per settings
// destination, gated exactly like the settings index page (capability in the
// literal here; NOT in WIDGET_REQUIRED_CAPABILITY below).
for (const shortcut of SETTINGS_SHORTCUTS) {
  ALL_WIDGET_DEFINITIONS.push({
    id: `settings-${shortcut.key}`,
    name: shortcut.label,
    description: shortcut.subtitle,
    icon: shortcut.iconName,
    category: 'settings',
    defaultDesktopSpan: span(2, 1),
    defaultMobileSpan: span(1, 1),
    // Static Link tile — no data fetching, so the interval is inert.
    defaultRefreshIntervalSecs: 300,
    supportsNarrow: true,
    mobileLayout: 'vertical',
    requiredCapability: shortcut.capability,
    adminOnly: shortcut.adminOnly,
    component: (props: WidgetProps) =>
      React.createElement(SettingsShortcutWidget, { shortcut, ...props }),
  } as WidgetDefinition);
}

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
    defaultRefreshIntervalSecs: 300,
    desktopLayout: 'carousel',
    mobileLayout: 'carousel',
    // continue-watching / plan-to-watch read the shared operator's AniList
    // account (admin-only endpoints), so hide them from members.
    adminOnly: id === 'continueWatching' || id === 'planToWatch',
    component: (props: WidgetProps) =>
      React.createElement(AnimeCarouselWidget, { carouselId: id, ...props }),
  } as WidgetDefinition);
}

// Capability-gated widgets: hidden from the dashboard + gallery for users who
// lack the capability. Every entry mirrors the capability checks of the data
// route(s) its component fetches, so a user never keeps a tile whose fetch
// would 403 into a misleading empty state.
const WIDGET_REQUIRED_CAPABILITY: Partial<Record<string, Capability | Capability[]>> = {
  // Activity widgets — /api/activity/* all require activity.view.
  'active-downloads': 'activity.view',
  'wanted-items': 'activity.view',
  'recently-added': 'activity.view',
  'activity-history': 'activity.view',
  // Calendar widgets — /api/calendar requires calendar.view.
  'upcoming': 'calendar.view',
  'today-calendar': 'calendar.view',
  // /api/notifications requires notifications.view.
  'notifications': 'notifications.view',
  // /api/jellyfin/resume requires jellyfin.view.
  'continue-watching': 'jellyfin.view',
  'prowlarr-indexers': 'prowlarr.view',
  'prowlarr-stats-summary': 'prowlarr.view',
  'prowlarr-response-time': 'prowlarr.view',
  'prowlarr-failure-rate': 'prowlarr.view',
  'prowlarr-queries-by-indexer': 'prowlarr.view',
  'prowlarr-grabs-by-indexer': 'prowlarr.view',
  'prowlarr-user-agent-queries': 'prowlarr.view',
  'prowlarr-user-agent-grabs': 'prowlarr.view',
  'torrent-overview': 'torrents.view',
  'now-streaming': 'jellyfin.sessions',
  'jellyfin-server': 'jellyfin.control',
  'jellyfin-scheduled-tasks': 'jellyfin.control',
  'jellyfin-devices': 'jellyfin.control',
  'jellyfin-activity': 'jellyfin.control',
  'jellyfin-alerts': 'jellyfin.control',
  'jellyfin-user-activity': 'jellyfin.stats',
  'jellyfin-play-history': 'jellyfin.stats',
  'jellyfin-playback-methods': 'jellyfin.stats',
  'jellyfin-top-tv-shows': 'jellyfin.stats',
  'jellyfin-top-movies': 'jellyfin.stats',
  'jellyfin-top-clients': 'jellyfin.stats',
  'jellyfin-top-devices': 'jellyfin.stats',
  'jellyfin-play-activity': 'jellyfin.stats',
  'jellyfin-hourly-activity': 'jellyfin.stats',
  'cleanup-status': 'cleanup.view',
  'cleanup-history': 'cleanup.view',
  'storage-usage': 'settings.storage',
  'seerr-pending-requests': 'requests.approve',
  // Recent-requests is member-safe: it scopes to the viewer's own requests and
  // surfaces their pending-approval items, so members may add it.
  'seerr-recent-requests': 'requests.view',
  'seerr-users': 'requests.approve',
  // Insights analytics — each entry mirrors its data route's capability checks
  // exactly, so a user never sees a tile whose fetch would 403 into a
  // misleading empty state.
  'library-growth': 'insights.view',
  // /api/library-gaps requires both library capabilities (no insights.view).
  'library-completeness': ['movies.view', 'series.view'],
  'download-reliability': 'insights.view',
  'download-pipeline': 'insights.view',
  'storage-breakdown': 'insights.view',
  // /api/insights/torrents checks insights.view first, then torrents.view.
  'seeding-economics': ['insights.view', 'torrents.view'],
  'media-technical-breakdown': 'insights.view',
  'media-quality-scores': 'insights.view',
  // Page-feature widgets — each mirrors its data route's capability checks.
  'watchlist': 'watchlist.view',
  // /api/library-gaps requires both library capabilities.
  'library-gaps': ['movies.view', 'series.view'],
  'random-watch': 'random.view',
};
for (const def of ALL_WIDGET_DEFINITIONS) {
  const cap = WIDGET_REQUIRED_CAPABILITY[def.id];
  if (cap) def.requiredCapability = cap;
}
