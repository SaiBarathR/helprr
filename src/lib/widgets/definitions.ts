import type { WidgetDefinition } from './types';

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
import { TorrentSummaryWidget } from '@/components/widgets/torrent-summary-widget';
import { TransferSpeedWidget } from '@/components/widgets/transfer-speed-widget';
import { WantedItemsWidget } from '@/components/widgets/wanted-items-widget';
import { NotificationsWidget } from '@/components/widgets/notifications-widget';
import { TodayCalendarWidget } from '@/components/widgets/today-calendar-widget';
import { StorageUsageWidget } from '@/components/widgets/storage-usage-widget';
import { JellyfinLibraryWidget } from '@/components/widgets/jellyfin-library-widget';
import { PlaybackChartWidget } from '@/components/widgets/playback-chart-widget';
import { ActivityHistoryWidget } from '@/components/widgets/activity-history-widget';

export const ALL_WIDGET_DEFINITIONS: WidgetDefinition[] = [
  // ── Existing ──
  {
    id: 'stats-grid',
    name: 'Stats Overview',
    description: 'Movies, series, downloads, and free space at a glance',
    icon: 'BarChart3',
    category: 'overview',
    sizes: ['medium', 'small'],
    defaultSize: 'medium',
    component: StatsGridWidget,
  },
  {
    id: 'prowlarr-indexers',
    name: 'Prowlarr Indexers',
    description: 'Indexer count with enabled/disabled/blocked status',
    icon: 'Layers',
    category: 'downloads',
    sizes: ['medium', 'small'],
    defaultSize: 'medium',
    component: ProwlarrIndexersWidget,
    requiredServices: ['PROWLARR'],
  },
  {
    id: 'now-streaming',
    name: 'Now Streaming',
    description: 'Active Jellyfin playback sessions',
    icon: 'MonitorPlay',
    category: 'streaming',
    sizes: ['large', 'medium'],
    defaultSize: 'large',
    component: NowStreamingWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'continue-watching',
    name: 'Continue Watching',
    description: 'Resume items from Jellyfin with progress bars',
    icon: 'PlayCircle',
    category: 'streaming',
    sizes: ['large', 'medium'],
    defaultSize: 'large',
    component: ContinueWatchingWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'active-downloads',
    name: 'Active Downloads',
    description: 'Current download queue with progress',
    icon: 'Download',
    category: 'downloads',
    sizes: ['large', 'medium'],
    defaultSize: 'large',
    component: ActiveDownloadsWidget,
  },
  {
    id: 'recently-added',
    name: 'Recently Added',
    description: 'Latest imports from Sonarr and Radarr',
    icon: 'Clock',
    category: 'media',
    sizes: ['large', 'medium'],
    defaultSize: 'large',
    component: RecentlyAddedWidget,
  },
  {
    id: 'upcoming',
    name: 'Upcoming',
    description: 'Movies and episodes releasing in the next 14 days',
    icon: 'Calendar',
    category: 'media',
    sizes: ['large', 'medium'],
    defaultSize: 'large',
    component: UpcomingWidget,
  },

  // ── New Widgets ──
  {
    id: 'service-health',
    name: 'Service Health',
    description: 'Connection status for all configured services',
    icon: 'Activity',
    category: 'monitoring',
    sizes: ['medium', 'small'],
    defaultSize: 'medium',
    component: ServiceHealthWidget,
  },
  {
    id: 'torrent-summary',
    name: 'Torrent Summary',
    description: 'Total, seeding, downloading, and paused torrent counts',
    icon: 'HardDrive',
    category: 'downloads',
    sizes: ['medium', 'small'],
    defaultSize: 'medium',
    component: TorrentSummaryWidget,
    requiredServices: ['QBITTORRENT'],
  },
  {
    id: 'transfer-speed',
    name: 'Transfer Speed',
    description: 'Real-time upload and download speeds',
    icon: 'ArrowUpDown',
    category: 'downloads',
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    component: TransferSpeedWidget,
    requiredServices: ['QBITTORRENT'],
  },
  {
    id: 'wanted-items',
    name: 'Wanted Items',
    description: 'Missing and cutoff unmet counts',
    icon: 'Search',
    category: 'media',
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    component: WantedItemsWidget,
  },
  {
    id: 'notifications',
    name: 'Recent Notifications',
    description: 'Latest push notification history',
    icon: 'Bell',
    category: 'monitoring',
    sizes: ['medium', 'large'],
    defaultSize: 'medium',
    component: NotificationsWidget,
  },
  {
    id: 'today-calendar',
    name: "Today's Calendar",
    description: 'Episodes and movies airing today',
    icon: 'CalendarDays',
    category: 'media',
    sizes: ['small', 'medium', 'large'],
    defaultSize: 'medium',
    component: TodayCalendarWidget,
  },
  {
    id: 'storage-usage',
    name: 'Storage Usage',
    description: 'Disk space breakdown with progress bars',
    icon: 'Database',
    category: 'monitoring',
    sizes: ['small', 'medium'],
    defaultSize: 'medium',
    component: StorageUsageWidget,
  },
  {
    id: 'jellyfin-library',
    name: 'Jellyfin Library',
    description: 'Movies, series, and episodes counts from Jellyfin',
    icon: 'Library',
    category: 'streaming',
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    component: JellyfinLibraryWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'playback-chart',
    name: 'Playback Activity',
    description: 'Hourly playback activity chart',
    icon: 'BarChart',
    category: 'streaming',
    sizes: ['large'],
    defaultSize: 'large',
    component: PlaybackChartWidget,
    requiredServices: ['JELLYFIN'],
  },
  {
    id: 'activity-history',
    name: 'Activity History',
    description: 'Recent import and grab events timeline',
    icon: 'History',
    category: 'media',
    sizes: ['medium', 'large'],
    defaultSize: 'medium',
    component: ActivityHistoryWidget,
  },
];
