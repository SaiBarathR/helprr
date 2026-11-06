'use client';

import {
  Server,
  Sliders,
  Bell,
  HardDrive,
  ScrollText,
  Palette,
  Download as DownloadIcon,
  UserCircle,
  Shield,
  Gauge,
  Users,
  Link2,
  Activity,
  FileStack,
  Terminal,
  Twitch, Youtube,
  Info,
  Lightbulb,
  Search,
} from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { jsonFetcher } from '@/lib/query-fetch';
import { GroupedSection } from '@/components/settings/grouped-section';
import { CategoryRow } from '@/components/settings/category-row';
import { Input } from '@/components/ui/input';
import { useMe, hasCapability } from '@/components/permission-provider';
import type { UpdateCheckResult } from '@/lib/update-check';
import { PageTitle } from '@/components/layout/page-title';

interface ServiceCount {
  configured: number;
  total: number;
}

const SERVICE_TYPES = ['SONARR', 'RADARR', 'LIDARR', 'QBITTORRENT', 'PROWLARR', 'JELLYFIN', 'TMDB', 'SEERR', 'TWITCH'] as const;

type GroupId = 'server' | 'integrations' | 'you' | 'data' | 'about';

// About sits alone at the end without a heading, like the last group in iOS Settings.
const GROUPS: ReadonlyArray<{ id: GroupId; title?: string }> = [
  { id: 'server', title: 'Server' },
  { id: 'integrations', title: 'Integrations' },
  { id: 'you', title: 'You' },
  { id: 'data', title: 'Data & logs' },
  { id: 'about' },
];

interface SettingsRow {
  group: GroupId;
  /** Permission gate; the matching API routes enforce the real check. */
  show: boolean;
  /** Extra filter terms for what lives inside the page but not in its title or subtitle. */
  keywords: readonly string[];
  row: ComponentProps<typeof CategoryRow>;
}

export default function SettingsIndexPage() {
  const me = useMe();
  const [filter, setFilter] = useState('');
  const canInstances = hasCapability(me, 'settings.instances');

  // members can't read connections; skip the 403 with enabled.
  const { data: serviceCount = null } = useQuery({
    queryKey: queryKeys.instances(),
    queryFn: jsonFetcher<Array<{ type?: string }>>('/api/services'),
    enabled: canInstances,
    // Count distinct service TYPES that have at least one connection — a type
    // with several instances (e.g. two Sonarr) still counts once, so the total
    // can't exceed SERVICE_TYPES.length.
    select: (data): ServiceCount => ({
      configured: Array.isArray(data)
        ? new Set(
            data
              .filter((c) => typeof c?.type === 'string' && (SERVICE_TYPES as readonly string[]).includes(c.type as string))
              .map((c) => c.type)
          ).size
        : 0,
      total: SERVICE_TYPES.length,
    }),
  });

  const instancesSubtitle = serviceCount
    ? `${serviceCount.configured} of ${serviceCount.total} connected`
    : 'Connect Sonarr, Radarr, qBittorrent, and more';

  const canStorage = hasCapability(me, 'settings.storage');
  const canLogging = hasCapability(me, 'settings.logging');
  const canViewLogs = hasCapability(me, 'logs.view');
  const canDownloads = hasCapability(me, 'settings.downloads');
  const canBackup = hasCapability(me, 'settings.backup');
  // Role-gated, not a capability — /api/users hard-requires the admin role.
  const canUsers = me?.role === 'admin';
  const { data: updateCheck = null } = useQuery({
    queryKey: queryKeys.adminUpdate(),
    queryFn: jsonFetcher<UpdateCheckResult>('/api/admin/update-check'),
    enabled: canUsers,
    staleTime: 5 * 60 * 1000,
  });
  const updateAvailable = updateCheck?.status === 'update_available';

  const rows: SettingsRow[] = [
    {
      group: 'server',
      show: canInstances,
      keywords: ['connections', 'services', 'sonarr', 'radarr', 'lidarr', 'qbittorrent', 'prowlarr', 'jellyfin', 'tmdb', 'seerr', 'anilist', 'api key', 'url'],
      row: { href: '/settings/instances', icon: Server, iconBg: 'bg-amber-500/10', iconColor: 'text-amber-500', label: 'Instances', subtitle: instancesSubtitle },
    },
    {
      group: 'server',
      show: canUsers,
      keywords: ['members', 'roles', 'permissions', 'capabilities', 'admin', 'add user', 'reset password'],
      row: { href: '/settings/users', icon: Users, iconBg: 'bg-violet-500/10', iconColor: 'text-violet-400', label: 'Users', subtitle: 'Members, roles, and permissions' },
    },
    {
      group: 'server',
      show: true,
      keywords: ['health', 'reachability', 'online', 'update', 'version'],
      row: {
        href: '/settings/status',
        icon: Activity,
        iconBg: updateAvailable ? 'bg-amber-500/10' : 'bg-teal-500/10',
        iconColor: updateAvailable ? 'text-amber-400' : 'text-teal-400',
        label: 'Service status',
        subtitle: updateAvailable && updateCheck.latestVersion
          ? `Helprr ${updateCheck.latestVersion} is available`
          : 'Live reachability of connected services',
        badge: updateAvailable ? 'Update' : undefined,
      },
    },
    {
      group: 'server',
      show: canDownloads,
      keywords: ['qbittorrent', 'bandwidth', 'speed limit', 'schedule', 'alternative speed'],
      row: { href: '/settings/downloads', icon: Gauge, iconBg: 'bg-amber-500/10', iconColor: 'text-amber-400', label: 'Downloads', subtitle: 'qBittorrent bandwidth scheduler' },
    },
    {
      group: 'integrations',
      show: hasCapability(me, 'youtube.manage'),
      keywords: ['channels', 'videos', 'yt-dlp', 'auto-download'],
      row: { href: '/settings/youtube', icon: Youtube, iconBg: 'bg-red-500/10', iconColor: 'text-red-400', label: 'YouTube', subtitle: 'Setup, rules, library' },
    },
    {
      group: 'integrations',
      show: Boolean(me?.twitchConfigured) && hasCapability(me, 'twitch.manage'),
      keywords: ['streams', 'vods', 'channels', 're-encode', 'retention'],
      row: { href: '/settings/twitch', icon: Twitch, iconBg: 'bg-violet-500/10', iconColor: 'text-violet-400', label: 'Twitch', subtitle: 'Auto-download, rules, library' },
    },
    {
      group: 'integrations',
      show: me?.role === 'admin',
      keywords: ['anime', 'anilist', 'seasons', 'mapping'],
      row: { href: '/settings/anime-mappings', icon: Link2, iconBg: 'bg-cyan-500/10', iconColor: 'text-cyan-400', label: 'Anime mappings', subtitle: 'AniList season links, bulk reset' },
    },
    {
      group: 'you',
      show: true,
      keywords: ['general', 'timezone', 'time zone', 'date format', 'time format', '12-hour', '24-hour', 'polling', 'refresh', 'where to watch', 'region', 'widgets', 'player', 'subtitles', 'skip'],
      row: { href: '/settings/preferences', icon: Sliders, iconBg: 'bg-sky-500/10', iconColor: 'text-sky-400', label: 'Preferences', subtitle: 'Timezone, date & time format, polling' },
    },
    {
      group: 'you',
      show: true,
      keywords: ['push', 'alerts', 'web push', 'devices', 'events', 'digest', 'history', 'upcoming releases'],
      row: { href: '/settings/notifications', icon: Bell, iconBg: 'bg-rose-500/10', iconColor: 'text-rose-400', label: 'Notifications', subtitle: 'Push, event types, devices, upcoming' },
    },
    {
      group: 'you',
      show: true,
      keywords: ['theme', 'dark mode', 'light mode', 'accent', 'color', 'font', 'nav', 'navigation', 'tabs', 'tab bar', 'bottom bar', 'sidebar', 'menu', 'carousels', 'discover', 'calendar', 'watch', 'cinematic', 'touch', 'haptics', 'vibration', 'install', 'home screen', 'pwa', 'shortcuts'],
      row: { href: '/settings/appearance', icon: Palette, iconBg: 'bg-fuchsia-500/10', iconColor: 'text-fuchsia-400', label: 'Appearance & Layout', subtitle: 'Theme, navigation, carousels, install' },
    },
    {
      group: 'you',
      show: true,
      keywords: ['devices', 'sign out', 'log out', 'logout', 'force logout', 'security'],
      row: { href: '/settings/sessions', icon: Shield, iconBg: 'bg-orange-500/10', iconColor: 'text-orange-400', label: 'Sessions', subtitle: 'Active devices, force logout' },
    },
    {
      group: 'you',
      show: true,
      keywords: ['profile', 'name', 'username', 'jellyfin', 'log out', 'logout'],
      row: {
        href: '/settings/account',
        icon: UserCircle,
        iconBg: 'bg-red-500/10',
        iconColor: 'text-red-400',
        label: 'Account',
        subtitle: me?.hasLocalPassword ? 'Profile, password and sign out' : 'Profile and sign out',
      },
    },
    {
      group: 'data',
      show: canStorage,
      keywords: ['cache', 'cleanup history', 'disk', 'space'],
      row: { href: '/settings/storage', icon: HardDrive, iconBg: 'bg-emerald-500/10', iconColor: 'text-emerald-400', label: 'Storage', subtitle: 'Cache and cleanup history' },
    },
    {
      group: 'data',
      show: canBackup,
      keywords: ['backup', 'export', 'import', 'restore', 'migrate'],
      row: { href: '/settings/backup', icon: DownloadIcon, iconBg: 'bg-yellow-500/10', iconColor: 'text-yellow-400', label: 'Backup & Restore', subtitle: 'Export or import your settings' },
    },
    {
      group: 'data',
      show: me?.role === 'admin',
      keywords: ['audit', 'history', 'deletes', 'deletions', 'edits', 'imports', 'sign-in', 'login', 'security'],
      row: { href: '/settings/file-audit', icon: FileStack, iconBg: 'bg-amber-500/10', iconColor: 'text-amber-400', label: 'Operation audit', subtitle: 'Media edits, deletes, imports; sign-ins and account changes' },
    },
    {
      group: 'data',
      show: canLogging,
      keywords: ['log level', 'debug', 'rotation', 'retention'],
      row: { href: '/settings/logging', icon: ScrollText, iconBg: 'bg-indigo-500/10', iconColor: 'text-indigo-400', label: 'Logging', subtitle: 'Level, rotation, retention' },
    },
    {
      group: 'data',
      show: canViewLogs,
      keywords: ['server logs', 'errors', 'debug'],
      row: { href: '/logs', icon: Terminal, iconBg: 'bg-blue-500/10', iconColor: 'text-blue-400', label: 'Logs', subtitle: 'View, search, and download server logs' },
    },
    {
      group: 'about',
      show: true,
      keywords: [
        'help', 'gestures', 'long-press', 'press and hold', 'right-click', 'swipe', 'pull to refresh',
        'search', 'scopes', 'tm', 'ani', 'tor', 'cmd+k', '⌘k', 'ctrl+k', 'keyboard', 'shortcuts', 'siri', 'automation',
      ],
      row: { href: '/settings/tips', icon: Lightbulb, iconBg: 'bg-amber-500/10', iconColor: 'text-amber-400', label: 'Tips & gestures', subtitle: 'Long-press, swipe, search scopes, Siri Shortcuts' },
    },
    {
      group: 'about',
      show: true,
      keywords: ['version', 'license', 'credits', 'open source', 'helprr'],
      row: { href: '/settings/about', icon: Info, iconBg: 'bg-slate-500/10', iconColor: 'text-slate-400', label: 'About', subtitle: 'Version, license, credits' },
    },
  ];

  const query = filter.trim().toLowerCase();
  const visibleRows = rows.filter((r) => r.show && (!query || rowMatches(r, query)));

  return (
    <div className="animate-content-in pb-12">
      <PageTitle className="px-4 mb-4">Settings</PageTitle>
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search settings"
          aria-label="Search settings"
          className="pl-9"
        />
      </div>

      {visibleRows.length === 0 && (
        <p role="status" className="px-4 py-8 text-center text-sm text-muted-foreground">
          No settings match &ldquo;{filter.trim()}&rdquo;
        </p>
      )}

      {GROUPS.map((group) => {
        const groupRows = visibleRows.filter((r) => r.group === group.id);
        if (groupRows.length === 0) return null;
        return (
          <GroupedSection key={group.id} title={group.title}>
            {groupRows.map((r) => <CategoryRow key={r.row.href} {...r.row} />)}
          </GroupedSection>
        );
      })}
    </div>
  );
}

function rowMatches(r: SettingsRow, query: string): boolean {
  return [r.row.label, r.row.subtitle ?? '', ...r.keywords].join(' ').toLowerCase().includes(query);
}
