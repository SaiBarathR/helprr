import {
  Activity,
  Bell,
  Download,
  FileStack,
  Gauge,
  HardDrive,
  Link2,
  Palette,
  ScrollText,
  Server,
  Shield,
  Sliders,
  Terminal,
  UserCircle,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Capability } from '@/lib/capabilities';

// Plain (non-'use client') module: definitions.ts iterates this at module
// scope, including in the server/instrumentation bundle where client-module
// exports are only reference proxies.
export interface SettingsShortcut {
  key: string;
  label: string;
  subtitle: string;
  href: string;
  /** Lucide icon NAME for the widget definition (gallery + refresh drawer). */
  iconName: string;
  icon: LucideIcon;
  /** Tailwind classes matching the settings index page tiles. */
  iconBg: string;
  iconColor: string;
  /** Mirrors the settings page gate; adminOnly covers the role==='admin' rows. */
  capability?: Capability;
  adminOnly?: boolean;
}

// Mirrors the destinations on /settings (src/app/(app)/settings/page.tsx) —
// same labels, icons, colors, and gates. Instances keeps a static subtitle;
// the "N of M connected" count stays page-only.
export const SETTINGS_SHORTCUTS: SettingsShortcut[] = [
  { key: 'instances', label: 'Instances', subtitle: 'Connect Sonarr, Radarr, qBittorrent, and more', href: '/settings/instances', iconName: 'Server', icon: Server, iconBg: 'bg-amber-500/10', iconColor: 'text-amber-500', capability: 'settings.instances' },
  { key: 'users', label: 'Users', subtitle: 'Members, roles, and permissions', href: '/settings/users', iconName: 'Users', icon: Users, iconBg: 'bg-violet-500/10', iconColor: 'text-violet-400', adminOnly: true },
  { key: 'anime-mappings', label: 'Anime mappings', subtitle: 'AniList season links, bulk reset', href: '/settings/anime-mappings', iconName: 'Link2', icon: Link2, iconBg: 'bg-cyan-500/10', iconColor: 'text-cyan-400', adminOnly: true },
  { key: 'file-audit', label: 'File operations', subtitle: 'Audit log of manage edits, deletes, imports', href: '/settings/file-audit', iconName: 'FileStack', icon: FileStack, iconBg: 'bg-amber-500/10', iconColor: 'text-amber-400', adminOnly: true },
  { key: 'preferences', label: 'Preferences', subtitle: 'Timezone, polling, refresh intervals', href: '/settings/preferences', iconName: 'Sliders', icon: Sliders, iconBg: 'bg-sky-500/10', iconColor: 'text-sky-400' },
  { key: 'notifications', label: 'Notifications', subtitle: 'Push, event types, devices, upcoming', href: '/settings/notifications', iconName: 'Bell', icon: Bell, iconBg: 'bg-rose-500/10', iconColor: 'text-rose-400' },
  { key: 'status', label: 'Service status', subtitle: 'Live reachability of connected services', href: '/settings/status', iconName: 'Activity', icon: Activity, iconBg: 'bg-teal-500/10', iconColor: 'text-teal-400' },
  { key: 'storage', label: 'Storage', subtitle: 'Cache and cleanup history', href: '/settings/storage', iconName: 'HardDrive', icon: HardDrive, iconBg: 'bg-emerald-500/10', iconColor: 'text-emerald-400', capability: 'settings.storage' },
  { key: 'logging', label: 'Logging', subtitle: 'Level, rotation, retention', href: '/settings/logging', iconName: 'ScrollText', icon: ScrollText, iconBg: 'bg-indigo-500/10', iconColor: 'text-indigo-400', capability: 'settings.logging' },
  { key: 'logs', label: 'Logs', subtitle: 'View, search, and download server logs', href: '/logs', iconName: 'Terminal', icon: Terminal, iconBg: 'bg-blue-500/10', iconColor: 'text-blue-400', capability: 'logs.view' },
  { key: 'downloads', label: 'Downloads', subtitle: 'qBittorrent bandwidth scheduler', href: '/settings/downloads', iconName: 'Gauge', icon: Gauge, iconBg: 'bg-amber-500/10', iconColor: 'text-amber-400', capability: 'settings.downloads' },
  { key: 'appearance', label: 'Appearance & Layout', subtitle: 'Theme, navigation, carousels, install', href: '/settings/appearance', iconName: 'Palette', icon: Palette, iconBg: 'bg-fuchsia-500/10', iconColor: 'text-fuchsia-400' },
  { key: 'backup', label: 'Backup & Restore', subtitle: 'Export or import your settings', href: '/settings/backup', iconName: 'Download', icon: Download, iconBg: 'bg-yellow-500/10', iconColor: 'text-yellow-400', capability: 'settings.backup' },
  { key: 'sessions', label: 'Sessions', subtitle: 'Active devices, force logout', href: '/settings/sessions', iconName: 'Shield', icon: Shield, iconBg: 'bg-orange-500/10', iconColor: 'text-orange-400' },
  { key: 'account', label: 'Account', subtitle: 'Sign out', href: '/settings/account', iconName: 'UserCircle', icon: UserCircle, iconBg: 'bg-red-500/10', iconColor: 'text-red-400' },
];
