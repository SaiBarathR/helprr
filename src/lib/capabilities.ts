import type { NotificationEventType } from '@/lib/notification-events';

// ─────────────────────────────────────────────────────────────────────────────
// Capability catalog — the single source of truth for what a user can do.
//
// Capabilities are `domain.action` strings. They are defined once here (grouped,
// with human labels for the admin override UI) and the flat `Capability` union +
// `CAPABILITIES` list are derived from the groups so the two never drift.
//
// This module is import-safe from BOTH client and server: it only `import type`s
// from notification-events (erased at build), so bundling it into the permission
// provider or notifications settings page never drags Prisma into the client.
// ─────────────────────────────────────────────────────────────────────────────

export interface CapabilityDef {
  readonly cap: string;
  readonly label: string;
}

export interface CapabilityGroup {
  readonly id: string;
  readonly title: string;
  readonly items: readonly CapabilityDef[];
}

export const CAPABILITY_GROUPS = [
  {
    id: 'library',
    title: 'Library',
    items: [
      { cap: 'dashboard.view', label: 'View dashboard' },
      { cap: 'dashboard.customize', label: 'Customize dashboard layout' },
      { cap: 'discover.view', label: 'Browse Discover' },
      { cap: 'anime.view', label: 'Browse Anime' },
      { cap: 'movies.view', label: 'View movies' },
      { cap: 'movies.add', label: 'Add movies to library' },
      { cap: 'movies.delete', label: 'Delete movies' },
      { cap: 'movies.editMonitoring', label: 'Change movie monitoring' },
      { cap: 'movies.editTags', label: 'Edit movie tags' },
      { cap: 'movies.changePath', label: 'Change movie root folder/path' },
      { cap: 'series.view', label: 'View series' },
      { cap: 'series.add', label: 'Add series to library' },
      { cap: 'series.delete', label: 'Delete series' },
      { cap: 'series.editMonitoring', label: 'Change series monitoring' },
      { cap: 'series.editTags', label: 'Edit series tags' },
      { cap: 'series.changePath', label: 'Change series root folder/path' },
      { cap: 'series.markWatched', label: 'Mark episodes watched' },
      { cap: 'watchlist.view', label: 'View watchlist' },
      { cap: 'watchlist.edit', label: 'Edit watchlist' },
      { cap: 'random.view', label: 'Use Random Watch' },
      { cap: 'calendar.view', label: 'View calendar' },
    ],
  },
  {
    id: 'requests',
    title: 'Requests',
    items: [
      { cap: 'requests.view', label: 'View requests' },
      { cap: 'requests.create', label: 'Create requests' },
      { cap: 'requests.autoApprove', label: 'Request without approval' },
      { cap: 'requests.approve', label: 'Approve / decline requests' },
    ],
  },
  {
    id: 'torrents',
    title: 'Torrents',
    items: [
      { cap: 'torrents.view', label: 'View torrents' },
      { cap: 'torrents.add', label: 'Add torrents' },
      { cap: 'torrents.manage', label: 'Manage torrents (pause/resume/etc.)' },
      { cap: 'torrents.delete', label: 'Delete torrents' },
      { cap: 'torrents.bandwidth', label: 'Change bandwidth limits' },
    ],
  },
  {
    id: 'jellyfin',
    title: 'Jellyfin',
    items: [
      { cap: 'jellyfin.view', label: 'View Jellyfin library' },
      { cap: 'jellyfin.control', label: 'Control server (scan / restart / tasks)' },
      { cap: 'jellyfin.sessions', label: 'View active sessions' },
      { cap: 'jellyfin.stats', label: 'View playback analytics' },
    ],
  },
  {
    id: 'activity',
    title: 'Activity',
    items: [
      { cap: 'activity.view', label: 'View activity & queue' },
      { cap: 'activity.manage', label: 'Manage queue (remove / import / search)' },
    ],
  },
  {
    id: 'admin',
    title: 'Admin subsystems',
    items: [
      { cap: 'cleanup.view', label: 'View cleanup rules & history' },
      { cap: 'cleanup.manage', label: 'Manage cleanup rules' },
      { cap: 'prowlarr.view', label: 'View Prowlarr' },
      { cap: 'prowlarr.manage', label: 'Manage Prowlarr indexers' },
      { cap: 'logs.view', label: 'View logs' },
      { cap: 'logs.manage', label: 'Delete logs' },
      { cap: 'users.manage', label: 'Manage users & permissions' },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    items: [
      { cap: 'settings.instances', label: 'Service connections' },
      { cap: 'settings.preferences', label: 'Preferences' },
      { cap: 'settings.notifications', label: 'Notification settings' },
      { cap: 'settings.storage', label: 'Storage / cache' },
      { cap: 'settings.logging', label: 'Logging settings' },
      { cap: 'settings.downloads', label: 'Download settings' },
      { cap: 'settings.appearance', label: 'Appearance' },
      { cap: 'settings.backup', label: 'Backup (export / import)' },
      { cap: 'settings.sessions', label: 'Sessions' },
      { cap: 'settings.account', label: 'Account' },
      { cap: 'settings.dashboardRefresh', label: 'Dashboard refresh settings' },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    items: [
      { cap: 'notifications.view', label: 'View notification history' },
      { cap: 'notify.media', label: 'Receive media notifications' },
      { cap: 'notify.torrents', label: 'Receive torrent notifications' },
      { cap: 'notify.jellyfin', label: 'Receive Jellyfin notifications' },
      { cap: 'notify.cleanup', label: 'Receive cleanup notifications' },
      { cap: 'notify.health', label: 'Receive health notifications' },
      { cap: 'notify.watchlist', label: 'Receive watchlist notifications' },
      { cap: 'notify.requests', label: 'Receive request notifications' },
      { cap: 'notify.digests', label: 'Receive activity digests' },
    ],
  },
] as const satisfies readonly CapabilityGroup[];

export type Capability = (typeof CAPABILITY_GROUPS)[number]['items'][number]['cap'];

export const CAPABILITIES: Capability[] = CAPABILITY_GROUPS.flatMap((group) =>
  group.items.map((item) => item.cap)
);

const CAPABILITY_SET = new Set<string>(CAPABILITIES);

export function isCapability(value: string): value is Capability {
  return CAPABILITY_SET.has(value);
}

// Maps each of the 20 notification event types to the `notify.*` capability that
// gates it. healthWarning is split out to notify.health so a member who receives
// media pushes still won't get health/cleanup alerts. notifyEvent() uses this as
// the OUTER gate (capability); NotificationPreference.enabled is the inner gate.
export const EVENT_TYPE_TO_CAPABILITY: Record<NotificationEventType, Capability> = {
  grabbed: 'notify.media',
  imported: 'notify.media',
  downloadFailed: 'notify.media',
  importFailed: 'notify.media',
  upcomingPremiere: 'notify.media',
  healthWarning: 'notify.health',
  torrentAdded: 'notify.torrents',
  torrentCompleted: 'notify.torrents',
  torrentDeleted: 'notify.torrents',
  jellyfinPlaybackStart: 'notify.jellyfin',
  cleanupStrike: 'notify.cleanup',
  cleanupRemoved: 'notify.cleanup',
  cleanupFailed: 'notify.cleanup',
  watchlistReminder: 'notify.watchlist',
  requestCreated: 'notify.requests',
  requestApproved: 'notify.requests',
  requestAvailable: 'notify.requests',
  requestDeclined: 'notify.requests',
  requestFailed: 'notify.requests',
  activityDigest: 'notify.digests',
};
