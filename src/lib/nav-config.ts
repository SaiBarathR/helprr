import {
  LayoutDashboard,
  Compass,
  Film,
  Tv,
  Disc3,
  CalendarDays,
  HardDrive,
  Search,
  Activity,
  MonitorPlay,
  Bell,
  Settings,
  Sparkles,
  Sparkle,
  Bookmark,
  Popcorn,
  Inbox,
  LibraryBig,
  ChartLine,
  Clapperboard,
  Twitch,
  Youtube,
  type LucideIcon,
} from 'lucide-react';
import type { Capability } from '@/lib/capabilities';
import type { BadgeArea } from '@/types/badges';

export type NavItemId =
  | 'dashboard'
  | 'discover'
  | 'anime'
  | 'movies'
  | 'series'
  | 'music'
  | 'watchlist'
  | 'requests'
  | 'random'
  | 'calendar'
  | 'library-gaps'
  | 'torrents'
  | 'cleanup'
  | 'prowlarr'
  | 'jellyfin'
  | 'jellyfin-library'
  | 'twitch'
  | 'youtube'
  | 'insights'
  | 'activity'
  | 'notifications'
  | 'settings';

/** Desktop sidebar sections. Items without a group are pinned to the sidebar footer. */
export type NavGroupId = 'overview' | 'library' | 'discover' | 'downloads' | 'media' | 'creators';

export const NAV_GROUP_LABELS: Record<NavGroupId, string> = {
  overview: 'Overview',
  library: 'Library',
  discover: 'Discover',
  downloads: 'Downloads',
  media: 'Media server',
  creators: 'Creators',
};

export interface NavItemDef {
  id: NavItemId;
  href: string;
  icon: LucideIcon;
  label: string;
  shortLabel: string;
  // Desktop sidebar section. Omitted only for the footer items (Notifications,
  // Settings), which stay in view below the scrolling list.
  group?: NavGroupId;
  pinned?: boolean;
  // When set, the item is hidden from users who lack this capability (UX only;
  // the page + its API routes enforce server-side).
  requiredCapability?: Capability;
  // Alternative gate: visible when the user holds ANY of these capabilities.
  // Used by multi-mode pages (Recommendations hosts both the personalized
  // rails and the old Random Watch, gated independently server-side).
  requiredAnyCapability?: readonly Capability[];
  // When set, the item stays hidden until this service is configured (UX only).
  requiresConfigured?: 'twitchConfigured' | 'youtubeConfigured';
  // When set, the item renders a live count badge from /api/badges.
  badgeArea?: BadgeArea;
}

/** Master ordered array of all navigation items — single source of truth */
export const NAV_ITEMS: NavItemDef[] = [
  { id: 'dashboard', href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', shortLabel: 'Dashboard', group: 'overview', requiredCapability: 'dashboard.view' },
  { id: 'discover', href: '/discover', icon: Compass, label: 'Discover', shortLabel: 'Discover', group: 'discover', requiredCapability: 'discover.view' },
  { id: 'anime', href: '/anime', icon: Sparkles, label: 'Anime', shortLabel: 'Anime', group: 'discover', requiredCapability: 'anime.view' },
  { id: 'movies', href: '/movies', icon: Film, label: 'Movies', shortLabel: 'Movies', group: 'library', requiredCapability: 'movies.view' },
  { id: 'series', href: '/series', icon: Tv, label: 'TV Series', shortLabel: 'Series', group: 'library', requiredCapability: 'series.view' },
  { id: 'music', href: '/music', icon: Disc3, label: 'Music', shortLabel: 'Music', group: 'library', requiredCapability: 'music.view' },
  { id: 'watchlist', href: '/watchlist', icon: Bookmark, label: 'Watchlist', shortLabel: 'Watchlist', group: 'library', requiredCapability: 'watchlist.view' },
  { id: 'requests', href: '/requests', icon: Inbox, label: 'Requests', shortLabel: 'Requests', group: 'discover', requiredCapability: 'requests.view', badgeArea: 'requests' },
  // Keeps the historical 'random' id so persisted nav orders / default-page
  // preferences survive the rename to Recommendations. Visible with EITHER
  // capability: a random.view-only user still reaches the Random mode.
  { id: 'random', href: '/recommendations', icon: Popcorn, label: 'Recommendations', shortLabel: 'For You', group: 'discover', requiredAnyCapability: ['recommendations.view', 'random.view'] },
  { id: 'calendar', href: '/calendar', icon: CalendarDays, label: 'Calendar', shortLabel: 'Calendar', group: 'library', requiredCapability: 'calendar.view' },
  { id: 'library-gaps', href: '/library-gaps', icon: LibraryBig, label: 'Library Gaps', shortLabel: 'Gaps', group: 'library' },
  { id: 'torrents', href: '/torrents', icon: HardDrive, label: 'Torrents', shortLabel: 'Torrents', group: 'downloads', requiredCapability: 'torrents.view', badgeArea: 'downloads' },
  { id: 'cleanup', href: '/cleanup', icon: Sparkle, label: 'Cleanup', shortLabel: 'Cleanup', group: 'downloads', requiredCapability: 'cleanup.view' },
  { id: 'prowlarr', href: '/prowlarr', icon: Search, label: 'Prowlarr', shortLabel: 'Prowlarr', group: 'downloads', requiredCapability: 'prowlarr.view' },
  { id: 'jellyfin-library', href: '/jellyfin/library', icon: Clapperboard, label: 'Watch', shortLabel: 'Watch', group: 'media', requiredCapability: 'jellyfin.view' },
  { id: 'jellyfin', href: '/jellyfin', icon: MonitorPlay, label: 'Jellyfin', shortLabel: 'Jellyfin', group: 'media', requiredCapability: 'jellyfin.view' },
  { id: 'twitch', href: '/twitch', icon: Twitch, label: 'Twitch', shortLabel: 'Twitch', group: 'creators', requiredCapability: 'twitch.view', requiresConfigured: 'twitchConfigured', badgeArea: 'twitch' },
  { id: 'youtube', href: '/youtube', icon: Youtube, label: 'YouTube', shortLabel: 'YouTube', group: 'creators', requiredCapability: 'youtube.view', requiresConfigured: 'youtubeConfigured', badgeArea: 'youtube' },
  { id: 'insights', href: '/insights', icon: ChartLine, label: 'Insights', shortLabel: 'Insights', group: 'overview', requiredCapability: 'insights.view' },
  { id: 'activity', href: '/activity', icon: Activity, label: 'Activity', shortLabel: 'Activity', group: 'downloads', requiredCapability: 'activity.view', badgeArea: 'activity' },
  { id: 'notifications', href: '/notifications', icon: Bell, label: 'Notifications', shortLabel: 'Alerts', requiredCapability: 'notifications.view', badgeArea: 'notifications' },
  { id: 'settings', href: '/settings', icon: Settings, label: 'Settings', shortLabel: 'Settings', pinned: true },
];

/** Capability gate shared by every nav surface (sidebar, bottom nav, dashboard
 * fallback). `has` abstracts over client (hasCapability) and server (can). */
export function navItemAllowed(
  item: NavItemDef,
  has: (cap: Capability) => boolean,
  configured?: { twitchConfigured?: boolean; youtubeConfigured?: boolean } | null,
): boolean {
  if (item.requiresConfigured && !configured?.[item.requiresConfigured]) return false;
  if (item.requiredAnyCapability) return item.requiredAnyCapability.some(has);
  return !item.requiredCapability || has(item.requiredCapability);
}

// The first four enabled items become the phone tabs, so a new install opens
// with the pages people check most; the rest follow in NAV_ITEMS order. A user
// who lacks one of these gets the next allowed item in that slot.
const DEFAULT_TAB_IDS: readonly NavItemId[] = ['dashboard', 'movies', 'series', 'activity'];

/** Default ID ordering */
export const DEFAULT_NAV_ORDER: NavItemId[] = [
  ...DEFAULT_TAB_IDS,
  ...NAV_ITEMS.map((item) => item.id).filter((id) => !DEFAULT_TAB_IDS.includes(id)),
];

/** ID → NavItemDef lookup */
export const NAV_ITEM_MAP: Record<NavItemId, NavItemDef> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.id, item])
) as Record<NavItemId, NavItemDef>;

/**
 * Produce the enabled navigation items in the user's reconciled order.
 *
 * Reconciles the provided `navOrder` with current known navigation items, filters out any IDs present
 * in `disabledNavItems`, and returns the resulting list of NavItemDef objects in the reconciled order.
 *
 * @param navOrder - Persisted or preferred ordering of navigation item IDs to reconcile against the current set
 * @param disabledNavItems - Navigation item IDs to exclude from the result
 * @returns The enabled NavItemDef objects in the reconciled order
 */
export function getEnabledNavItems(
  navOrder: NavItemId[],
  disabledNavItems: NavItemId[]
): NavItemDef[] {
  const disabledSet = new Set(disabledNavItems);
  return reconcileNavOrder(navOrder).reduce<NavItemDef[]>((acc, id) => {
    if (!disabledSet.has(id)) {
      const item = NAV_ITEM_MAP[id];
      if (item) acc.push(item);
    }
    return acc;
  }, []);
}

/**
 * The href of the nav item that should highlight for `pathname` — the longest
 * matching prefix wins, so `/jellyfin/library` activates "Jellyfin Library"
 * without also activating "Jellyfin".
 */
export function getActiveNavHref(items: NavItemDef[], pathname: string): string | undefined {
  let best: string | undefined;
  for (const { href } of items) {
    const matches = pathname === href || pathname.startsWith(href + '/');
    if (matches && (best === undefined || href.length > best.length)) best = href;
  }
  return best;
}

export interface ResolveDefaultPageHrefInput {
  defaultPage: NavItemId;
  navOrder: NavItemId[];
  disabledNavItems: NavItemId[];
  fallbackHref?: string;
}

/**
 * Resolve the route to use for app entry (login/root/PWA launch).
 *
 * Uses the configured default page when enabled. If it is disabled or invalid, falls back to the
 * first enabled non-pinned item. If no non-pinned items are enabled, returns `fallbackHref`.
 */
export function resolveDefaultPageHref({
  defaultPage,
  navOrder,
  disabledNavItems,
  fallbackHref = '/dashboard',
}: ResolveDefaultPageHrefInput): string {
  const enabledItems = getEnabledNavItems(navOrder, disabledNavItems);
  const defaultItem = enabledItems.find((item) => item.id === defaultPage);
  if (defaultItem) return defaultItem.href;

  const firstNonPinned = enabledItems.find((item) => !item.pinned);
  if (firstNonPinned) return firstNonPinned.href;

  return fallbackHref;
}

/**
 * Produce a bottom navigation layout from enabled navigation items.
 *
 * @param enabledItems - Enabled navigation items in the order they should appear
 * @returns An object with `tabs` containing the first four items and `moreItems` containing the remaining items
 */
export function getBottomNavLayout(enabledItems: NavItemDef[]) {
  return {
    tabs: enabledItems.slice(0, 4),
    moreItems: enabledItems.slice(4),
  };
}

export interface SidebarSection {
  group: NavGroupId;
  label: string;
  items: NavItemDef[];
}

/**
 * Split enabled items into the desktop sidebar's labelled sections and its
 * always-visible footer. The input order (the user's saved order) is kept
 * inside each section, and sections appear in the order of their first item,
 * so moving an item to the top in Appearance also lifts its section.
 */
export function getSidebarLayout(enabledItems: NavItemDef[]): {
  sections: SidebarSection[];
  footer: NavItemDef[];
} {
  const sections: SidebarSection[] = [];
  const footer: NavItemDef[] = [];
  for (const item of enabledItems) {
    if (!item.group) {
      footer.push(item);
      continue;
    }
    let section = sections.find((s) => s.group === item.group);
    if (!section) {
      section = { group: item.group, label: NAV_GROUP_LABELS[item.group], items: [] };
      sections.push(section);
    }
    section.items.push(item);
  }
  return { sections, footer };
}

/**
 * Reconciles a persisted navigation order with the current set of navigation items.
 *
 * @param persisted - Persisted navigation item IDs in the user's preferred order.
 * @returns The reconciled order: persisted IDs that still exist first, followed by any new IDs appended in the current NAV_ITEMS order.
 */
export function reconcileNavOrder(persisted: NavItemId[]): NavItemId[] {
  const allIds = new Set<NavItemId>(NAV_ITEMS.map((i) => i.id));
  // Keep persisted items that still exist
  const reconciled = persisted.filter((id) => allIds.has(id));
  // Append any new items not in persisted order
  const persistedSet = new Set(reconciled);
  for (const id of allIds) {
    if (!persistedSet.has(id)) {
      reconciled.push(id);
    }
  }
  return reconciled;
}
