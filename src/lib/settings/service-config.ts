import { Film, Tv, Download, Search, MonitorPlay, Compass, Inbox } from 'lucide-react';

export const SERVICE_CONFIG = [
  {
    type: 'RADARR' as const,
    slug: 'radarr',
    label: 'Radarr',
    icon: Film,
    dotColor: 'bg-purple-500',
    iconBg: 'bg-purple-500/10',
    iconColor: 'text-purple-400',
    placeholder: 'http://localhost:7878',
    supportsExternalUrl: true,
  },
  {
    type: 'SONARR' as const,
    slug: 'sonarr',
    label: 'Sonarr',
    icon: Tv,
    dotColor: 'bg-blue-500',
    iconBg: 'bg-blue-500/10',
    iconColor: 'text-blue-400',
    placeholder: 'http://localhost:8989',
    supportsExternalUrl: true,
  },
  {
    type: 'QBITTORRENT' as const,
    slug: 'qbittorrent',
    label: 'qBittorrent',
    icon: Download,
    dotColor: 'bg-green-500',
    iconBg: 'bg-green-500/10',
    iconColor: 'text-green-400',
    placeholder: 'http://localhost:8080',
    supportsExternalUrl: false,
  },
  {
    type: 'PROWLARR' as const,
    slug: 'prowlarr',
    label: 'Prowlarr',
    icon: Search,
    dotColor: 'bg-orange-500',
    iconBg: 'bg-orange-500/10',
    iconColor: 'text-orange-400',
    placeholder: 'http://localhost:9696',
    supportsExternalUrl: false,
  },
  {
    type: 'JELLYFIN' as const,
    slug: 'jellyfin',
    label: 'Jellyfin',
    icon: MonitorPlay,
    dotColor: 'bg-[var(--hpr-cyan)]',
    iconBg: 'bg-cyan-500/10',
    iconColor: 'text-cyan-400',
    placeholder: 'http://localhost:8096',
    supportsExternalUrl: true,
  },
  {
    type: 'TMDB' as const,
    slug: 'tmdb',
    label: 'TMDB',
    icon: Compass,
    dotColor: 'bg-cyan-500',
    iconBg: 'bg-cyan-500/10',
    iconColor: 'text-cyan-400',
    placeholder: 'https://api.themoviedb.org/3',
    supportsExternalUrl: false,
  },
  {
    type: 'SEERR' as const,
    slug: 'seerr',
    label: 'Seerr',
    icon: Inbox,
    dotColor: 'bg-amber-500',
    iconBg: 'bg-amber-500/10',
    iconColor: 'text-amber-400',
    placeholder: 'http://localhost:5055',
    supportsExternalUrl: true,
  },
] as const;

export type ServiceConfig = (typeof SERVICE_CONFIG)[number];
export type ServiceConfigType = ServiceConfig['type'];
export type ServiceSlug = ServiceConfig['slug'];

export function findServiceBySlug(slug: string): ServiceConfig | undefined {
  return SERVICE_CONFIG.find((c) => c.slug === slug);
}

export function findServiceByType(type: string): ServiceConfig | undefined {
  return SERVICE_CONFIG.find((c) => c.type === type);
}
