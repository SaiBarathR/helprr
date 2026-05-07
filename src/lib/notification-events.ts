import { prisma } from '@/lib/db';

export const EVENT_TYPES = [
  'grabbed', 'imported', 'downloadFailed', 'importFailed',
  'upcomingPremiere', 'healthWarning',
  'torrentAdded', 'torrentCompleted', 'torrentDeleted',
  'jellyfinPlaybackStart',
] as const;

export type NotificationEventType = (typeof EVENT_TYPES)[number];

export type NotificationEventGroupId = 'sonarrRadarr' | 'qbittorrent' | 'jellyfin';

export interface NotificationEventMeta {
  type: NotificationEventType;
  group: NotificationEventGroupId;
  label: string;
  description: string;
  iconName: 'Download' | 'Check' | 'X' | 'AlertTriangle' | 'Clock' | 'Trash2' | 'Play' | 'Bell';
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
  downloadFailed: {
    type: 'downloadFailed', group: 'sonarrRadarr',
    label: 'Download Failed',
    description: 'When a download fails',
    iconName: 'X', colorClass: 'bg-red-500/10 text-red-500',
  },
  importFailed: {
    type: 'importFailed', group: 'sonarrRadarr',
    label: 'Import Failed',
    description: 'When an import fails',
    iconName: 'X', colorClass: 'bg-red-500/10 text-red-500',
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
};

export const EVENT_GROUPS: { id: NotificationEventGroupId; title: string; types: NotificationEventType[] }[] = [
  {
    id: 'sonarrRadarr',
    title: 'Sonarr / Radarr',
    types: ['grabbed', 'imported', 'downloadFailed', 'importFailed', 'upcomingPremiere', 'healthWarning'],
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
];

export function isKnownEventType(value: string): value is NotificationEventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

export async function ensureNotificationPreferences(subscriptionId: string): Promise<void> {
  await prisma.notificationPreference.createMany({
    data: EVENT_TYPES.map((eventType) => ({
      subscriptionId,
      eventType,
      enabled: true,
    })),
    skipDuplicates: true,
  });
}
