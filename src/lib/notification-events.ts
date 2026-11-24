import { prisma } from '@/lib/db';

export const EVENT_TYPES = [
  'grabbed', 'imported', 'upgraded', 'downloadFailed', 'importFailed',
  'titleAdded', 'titleDeleted', 'fileDeleted', 'fileRenamed',
  'upcomingPremiere', 'healthWarning', 'healthRestored',
  'serviceDown', 'serviceRestored', 'diskLowSpace', 'databaseBackup', 'arrUpdateAvailable',
  'torrentAdded', 'torrentCompleted', 'torrentDeleted',
  'jellyfinPlaybackStart',
  'cleanupStrike', 'cleanupRemoved', 'cleanupFailed',
  'watchlistReminder', 'watchlistAvailable', 'watchingNewEpisode',
  'scheduledAlert',
  'requestCreated', 'requestApproved', 'requestAvailable',
  'requestDeclined', 'requestFailed', 'leavingSoon',
  'activityDigest',
  'twitchVodNew', 'twitchVodExpiring', 'twitchDownloadComplete',
  'twitchDownloadFailed', 'twitchWorkerIssue',
  'youtubeVideoNew', 'youtubeDownloadComplete', 'youtubeDownloadFailed', 'youtubeCookiesExpired', 'youtubeCleanupPaused',
  'updateAvailable', 'securityAlert',
  'tonightPickInvite',
] as const;

export type NotificationEventType = (typeof EVENT_TYPES)[number];

export type NotificationEventGroupId = 'sonarrRadarr' | 'services' | 'qbittorrent' | 'jellyfin' | 'cleanup' | 'watchlist' | 'scheduled' | 'requests' | 'digests' | 'twitch' | 'youtube' | 'helprr' | 'random';

export interface NotificationEventMeta {
  type: NotificationEventType;
  group: NotificationEventGroupId;
  label: string;
  description: string;
  iconName: 'Download' | 'Check' | 'CircleArrowUp' | 'CirclePlus' | 'FileX' | 'FilePen' | 'X' | 'AlertTriangle' | 'Clock' | 'Trash2' | 'Play' | 'Bell' | 'Newspaper';
  colorClass: string;
}

export const EVENT_META: Record<NotificationEventType, NotificationEventMeta> = {
  grabbed: {
    type: 'grabbed', group: 'sonarrRadarr',
    label: 'Download Grabbed',
    description: 'When Sonarr/Radarr grabs a download',
    iconName: 'Download', colorClass: 'bg-blue-500/10 text-blue-500',
  },
  imported: {
    type: 'imported', group: 'sonarrRadarr',
    label: 'Media Imported',
    description: 'When a download is imported to library',
    iconName: 'Check', colorClass: 'bg-green-500/10 text-green-500',
  },
  upgraded: {
    type: 'upgraded', group: 'sonarrRadarr',
    label: 'Media Upgraded',
    description: 'When a better copy replaces a file already in the library',
    iconName: 'CircleArrowUp', colorClass: 'bg-green-500/10 text-green-500',
  },
  downloadFailed: {
    type: 'downloadFailed', group: 'sonarrRadarr',
    label: 'Download Failed',
    description: 'When a download fails',
    iconName: 'X', colorClass: 'bg-red-500/10 text-red-500',
  },
  importFailed: {
    type: 'importFailed', group: 'sonarrRadarr',
    label: 'Import Failed',
    description: 'When a download cannot be imported and needs a manual import (the apps\' "Manual Interaction Required")',
    iconName: 'X', colorClass: 'bg-red-500/10 text-red-500',
  },
  titleAdded: {
    type: 'titleAdded', group: 'sonarrRadarr',
    label: 'Title Added',
    description: 'When a series or movie is added to Sonarr/Radarr: from Helprr, in the app itself or by an import list',
    iconName: 'CirclePlus', colorClass: 'bg-blue-500/10 text-blue-500',
  },
  titleDeleted: {
    type: 'titleDeleted', group: 'sonarrRadarr',
    label: 'Title Deleted',
    description: 'When a series or movie is removed from Sonarr/Radarr',
    iconName: 'Trash2', colorClass: 'bg-zinc-500/10 text-zinc-400',
  },
  fileDeleted: {
    type: 'fileDeleted', group: 'sonarrRadarr',
    label: 'File Deleted',
    description: 'When an episode or movie file is deleted, or found missing from disk (not when an upgrade replaces it)',
    iconName: 'FileX', colorClass: 'bg-rose-500/10 text-rose-400',
  },
  fileRenamed: {
    type: 'fileRenamed', group: 'sonarrRadarr',
    label: 'Files Renamed',
    description: 'When Sonarr/Radarr renames the files of a series or movie',
    iconName: 'FilePen', colorClass: 'bg-cyan-500/10 text-cyan-500',
  },
  upcomingPremiere: {
    type: 'upcomingPremiere', group: 'sonarrRadarr',
    label: 'Upcoming Premiere',
    description: 'Upcoming episode or movie release',
    iconName: 'Clock', colorClass: 'bg-purple-500/10 text-purple-500',
  },
  healthWarning: {
    type: 'healthWarning', group: 'sonarrRadarr',
    label: 'Health Warning',
    description: 'When a service has health issues',
    iconName: 'AlertTriangle', colorClass: 'bg-orange-500/10 text-orange-500',
  },
  healthRestored: {
    type: 'healthRestored', group: 'sonarrRadarr',
    label: 'Health Restored',
    description: 'When a service\'s health issues have cleared',
    iconName: 'Check', colorClass: 'bg-green-500/10 text-green-500',
  },
  serviceDown: {
    type: 'serviceDown', group: 'services',
    label: 'Service Down',
    description: 'When a connected service becomes unreachable',
    iconName: 'AlertTriangle', colorClass: 'bg-red-500/10 text-red-500',
  },
  serviceRestored: {
    type: 'serviceRestored', group: 'services',
    label: 'Service Restored',
    description: 'When an unreachable service comes back online',
    iconName: 'Check', colorClass: 'bg-green-500/10 text-green-500',
  },
  diskLowSpace: {
    type: 'diskLowSpace', group: 'services',
    label: 'Low Disk Space',
    description: 'When a disk drops below its free-space threshold',
    iconName: 'AlertTriangle', colorClass: 'bg-orange-500/10 text-orange-500',
  },
  databaseBackup: {
    type: 'databaseBackup', group: 'services',
    label: 'Database Backup',
    description: 'When a scheduled database backup fails, or the last one is too old (admins)',
    iconName: 'AlertTriangle', colorClass: 'bg-amber-500/10 text-amber-400',
  },
  arrUpdateAvailable: {
    type: 'arrUpdateAvailable', group: 'services',
    label: 'App Update Available',
    description: 'When Sonarr, Radarr, Lidarr or Prowlarr has a new version, once per version (admins)',
    iconName: 'Download', colorClass: 'bg-sky-500/10 text-sky-400',
  },
  torrentAdded: {
    type: 'torrentAdded', group: 'qbittorrent',
    label: 'Torrent Added',
    description: 'When a new torrent is added',
    iconName: 'Download', colorClass: 'bg-cyan-500/10 text-cyan-500',
  },
  torrentCompleted: {
    type: 'torrentCompleted', group: 'qbittorrent',
    label: 'Download Complete',
    description: 'When a torrent finishes downloading',
    iconName: 'Check', colorClass: 'bg-emerald-500/10 text-emerald-500',
  },
  torrentDeleted: {
    type: 'torrentDeleted', group: 'qbittorrent',
    label: 'Torrent Removed',
    description: 'When a torrent is removed',
    iconName: 'Trash2', colorClass: 'bg-zinc-500/10 text-zinc-400',
  },
  jellyfinPlaybackStart: {
    type: 'jellyfinPlaybackStart', group: 'jellyfin',
    label: 'Playback Started',
    description: 'Someone started streaming',
    iconName: 'Play', colorClass: 'bg-indigo-500/10 text-indigo-400',
  },
  cleanupStrike: {
    type: 'cleanupStrike', group: 'cleanup',
    label: 'Cleanup Strike',
    description: 'A torrent received a cleanup strike',
    iconName: 'AlertTriangle', colorClass: 'bg-amber-500/10 text-amber-500',
  },
  cleanupRemoved: {
    type: 'cleanupRemoved', group: 'cleanup',
    label: 'Cleanup Removed',
    description: 'A torrent was removed by cleanup',
    iconName: 'Trash2', colorClass: 'bg-rose-500/10 text-rose-400',
  },
  cleanupFailed: {
    type: 'cleanupFailed', group: 'cleanup',
    label: 'Cleanup Failed',
    description: 'A cleanup action failed (deletion or category change)',
    iconName: 'X', colorClass: 'bg-red-500/10 text-red-500',
  },
  watchlistReminder: {
    type: 'watchlistReminder', group: 'watchlist',
    label: 'Watchlist Reminder',
    description: 'A watchlist item reached its reminder date',
    iconName: 'Bell', colorClass: 'bg-amber-500/10 text-amber-400',
  },
  watchlistAvailable: {
    type: 'watchlistAvailable', group: 'watchlist',
    label: 'Now in Your Library',
    description: 'When a movie or series on your watchlist is imported',
    iconName: 'Check', colorClass: 'bg-green-500/10 text-green-500',
  },
  watchingNewEpisode: {
    type: 'watchingNewEpisode', group: 'watchlist',
    label: 'New Episodes of Your Shows',
    description: 'When a new episode of a series you played in Jellyfin recently is imported',
    iconName: 'Play', colorClass: 'bg-green-500/10 text-green-500',
  },
  scheduledAlert: {
    type: 'scheduledAlert', group: 'scheduled',
    label: 'Scheduled Alert',
    description: 'A user-scheduled release or custom reminder',
    iconName: 'Bell', colorClass: 'bg-violet-500/10 text-violet-400',
  },
  requestCreated: {
    type: 'requestCreated', group: 'requests',
    label: 'New Request',
    description: 'A new Seerr request was submitted',
    iconName: 'Bell', colorClass: 'bg-amber-500/10 text-amber-500',
  },
  requestApproved: {
    type: 'requestApproved', group: 'requests',
    label: 'Request Approved',
    description: 'A Seerr request was approved',
    iconName: 'Check', colorClass: 'bg-blue-500/10 text-blue-500',
  },
  requestAvailable: {
    type: 'requestAvailable', group: 'requests',
    label: 'Request Available',
    description: 'Requested media is now available in your library',
    iconName: 'Check', colorClass: 'bg-green-500/10 text-green-500',
  },
  requestDeclined: {
    type: 'requestDeclined', group: 'requests',
    label: 'Request Declined',
    description: 'A Seerr request was declined',
    iconName: 'X', colorClass: 'bg-rose-500/10 text-rose-500',
  },
  requestFailed: {
    type: 'requestFailed', group: 'requests',
    label: 'Request Failed',
    description: 'A Seerr request failed to fulfil',
    iconName: 'AlertTriangle', colorClass: 'bg-red-500/10 text-red-500',
  },
  leavingSoon: {
    type: 'leavingSoon', group: 'requests',
    label: 'Leaving Soon',
    description: 'When a title you requested is marked Leaving soon by library cleanup',
    iconName: 'Clock', colorClass: 'bg-amber-500/10 text-amber-400',
  },
  activityDigest: {
    type: 'activityDigest', group: 'digests',
    label: 'Activity Digest',
    description: 'A daily or weekly summary of activity (imports, failures, releases)',
    iconName: 'Newspaper', colorClass: 'bg-amber-500/10 text-amber-400',
  },
  twitchVodNew: {
    type: 'twitchVodNew', group: 'twitch',
    label: 'New Twitch VOD',
    description: 'When a subscribed streamer publishes a new video',
    iconName: 'Play', colorClass: 'bg-violet-500/10 text-violet-400',
  },
  twitchVodExpiring: {
    type: 'twitchVodExpiring', group: 'twitch',
    label: 'Twitch VOD Expiring',
    description: 'When a VOD you have not saved is about to expire',
    iconName: 'Clock', colorClass: 'bg-amber-500/10 text-amber-400',
  },
  twitchDownloadComplete: {
    type: 'twitchDownloadComplete', group: 'twitch',
    label: 'Twitch Download Complete',
    description: 'When a VOD has landed in the Jellyfin library',
    iconName: 'Check', colorClass: 'bg-green-500/10 text-green-500',
  },
  twitchDownloadFailed: {
    type: 'twitchDownloadFailed', group: 'twitch',
    label: 'Twitch Download Failed',
    description: 'When a VOD download fails for good',
    iconName: 'X', colorClass: 'bg-red-500/10 text-red-500',
  },
  twitchWorkerIssue: {
    type: 'twitchWorkerIssue', group: 'twitch',
    label: 'Twitch Worker Issue',
    description: 'When the Twitch worker is offline or its tools stop working',
    iconName: 'AlertTriangle', colorClass: 'bg-amber-500/10 text-amber-400',
  },
  youtubeVideoNew: {
    type: 'youtubeVideoNew', group: 'youtube',
    label: 'New YouTube Video',
    description: 'When a followed channel or playlist has a new video',
    iconName: 'Play', colorClass: 'bg-red-500/10 text-red-400',
  },
  youtubeDownloadComplete: {
    type: 'youtubeDownloadComplete', group: 'youtube',
    label: 'YouTube Download Complete',
    description: 'When a video has landed in the Jellyfin library',
    iconName: 'Check', colorClass: 'bg-green-500/10 text-green-500',
  },
  youtubeDownloadFailed: {
    type: 'youtubeDownloadFailed', group: 'youtube',
    label: 'YouTube Download Failed',
    description: 'When a video download fails for good',
    iconName: 'X', colorClass: 'bg-red-500/10 text-red-500',
  },
  youtubeCookiesExpired: {
    type: 'youtubeCookiesExpired', group: 'youtube',
    label: 'YouTube Account Needs Signing In',
    description: 'When the account for age-restricted videos stops working',
    iconName: 'AlertTriangle', colorClass: 'bg-amber-500/10 text-amber-400',
  },
  youtubeCleanupPaused: {
    type: 'youtubeCleanupPaused', group: 'youtube',
    label: 'YouTube Cleanup Paused',
    description: 'Automatic cleanup hit its limit, or could not read what was watched',
    iconName: 'AlertTriangle', colorClass: 'bg-amber-500/10 text-amber-400',
  },
  updateAvailable: {
    type: 'updateAvailable', group: 'helprr',
    label: 'Helprr Update Available',
    description: 'When a new Helprr release is out, once per version (admins)',
    iconName: 'Download', colorClass: 'bg-sky-500/10 text-sky-400',
  },
  securityAlert: {
    type: 'securityAlert', group: 'helprr',
    label: 'Security Alert',
    description: 'An admin signed in on a new device, a burst of failed sign-ins, or two-step sign-in was turned off (admins)',
    iconName: 'AlertTriangle', colorClass: 'bg-red-500/10 text-red-500',
  },
  tonightPickInvite: {
    type: 'tonightPickInvite', group: 'random',
    label: 'Tonight Pick Invite',
    description: 'When someone in your household asks you to pick something to watch together',
    iconName: 'Play', colorClass: 'bg-amber-500/10 text-amber-400',
  },
};

export const EVENT_GROUPS: { id: NotificationEventGroupId; title: string; types: NotificationEventType[] }[] = [
  {
    id: 'sonarrRadarr',
    title: 'Sonarr / Radarr',
    types: ['grabbed', 'imported', 'upgraded', 'downloadFailed', 'importFailed', 'titleAdded', 'titleDeleted', 'fileDeleted', 'fileRenamed', 'upcomingPremiere', 'healthWarning', 'healthRestored'],
  },
  {
    id: 'services',
    title: 'Services',
    types: ['serviceDown', 'serviceRestored', 'diskLowSpace', 'databaseBackup', 'arrUpdateAvailable'],
  },
  {
    id: 'qbittorrent',
    title: 'qBittorrent',
    types: ['torrentAdded', 'torrentCompleted', 'torrentDeleted'],
  },
  {
    id: 'jellyfin',
    title: 'Jellyfin',
    types: ['jellyfinPlaybackStart'],
  },
  {
    id: 'cleanup',
    title: 'Cleanup',
    types: ['cleanupStrike', 'cleanupRemoved', 'cleanupFailed'],
  },
  {
    id: 'watchlist',
    title: 'Watchlist',
    types: ['watchlistReminder', 'watchlistAvailable', 'watchingNewEpisode'],
  },
  {
    id: 'scheduled',
    title: 'Scheduled Alerts',
    types: ['scheduledAlert'],
  },
  {
    id: 'requests',
    title: 'Requests (Seerr)',
    types: [
      'requestCreated',
      'requestApproved',
      'requestAvailable',
      'requestDeclined',
      'requestFailed',
      'leavingSoon',
    ],
  },
  {
    id: 'digests',
    title: 'Digests',
    types: ['activityDigest'],
  },
  {
    id: 'twitch',
    title: 'Twitch',
    types: ['twitchVodNew', 'twitchVodExpiring', 'twitchDownloadComplete', 'twitchDownloadFailed', 'twitchWorkerIssue'],
  },
  {
    id: 'youtube',
    title: 'YouTube',
    types: ['youtubeVideoNew', 'youtubeDownloadComplete', 'youtubeDownloadFailed', 'youtubeCookiesExpired', 'youtubeCleanupPaused'],
  },
  {
    id: 'helprr',
    title: 'Helprr',
    types: ['updateAvailable', 'securityAlert'],
  },
  {
    id: 'random',
    title: 'Random',
    types: ['tonightPickInvite'],
  },
];

// "New Episodes of Your Shows" (watchingNewEpisode): a series counts when the
// person played it in Jellyfin within this many days; 0 turns it off for them.
export const WATCHING_EPISODE_DAYS_DEFAULT = 14;
export const WATCHING_EPISODE_DAY_OPTIONS = [0, 7, 14, 30, 60, 90] as const;

// Events a device or channel gets only once its owner turns them on: an invite
// to pick together is too easy to send for everyone to hear it unasked (owner,
// 2026-11-07). A missing preference row reads as this default.
// The library and file changes and app updates (AR-17) are mostly noise (an
// import list adding a hundred titles, a series renamed file by file), so
// they are opt-in too. That is also their starting state on devices and
// channels from before they existed: such a device has no row for them and a
// channel does not list them, so neither starts getting them.
const DEFAULT_OFF_EVENT_TYPES: ReadonlySet<string> = new Set<NotificationEventType>([
  'tonightPickInvite',
  'titleAdded', 'titleDeleted', 'fileDeleted', 'fileRenamed', 'arrUpdateAvailable',
]);

export function eventEnabledByDefault(eventType: string): boolean {
  return !DEFAULT_OFF_EVENT_TYPES.has(eventType);
}

export function isKnownEventType(value: string): value is NotificationEventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

export async function ensureNotificationPreferences(subscriptionId: string): Promise<void> {
  await prisma.notificationPreference.createMany({
    data: EVENT_TYPES.map((eventType) => ({
      subscriptionId,
      eventType,
      enabled: eventEnabledByDefault(eventType),
    })),
    skipDuplicates: true,
  });
}
