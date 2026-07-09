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
  Dices,
  Inbox,
  LibraryBig,
  ChartLine,
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
  | 'insights'
  | 'activity'
  | 'notifications'
  | 'settings';

export interface NavItemDef {
  id: NavItemId;
  href: string;
  icon: LucideIcon;
  label: string;
  shortLabel: string;
  pinned?: boolean;
  // When set, the item is hidden from users who lack this capability (UX only;
  // the page + its API routes enforce server-side).
  requiredCapability?: Capability;
  // When set, the item renders a live count badge from /api/badges.
  badgeArea?: BadgeArea;
}

/** Master ordered array of all navigation items — single source of truth */
export const NAV_ITEMS: NavItemDef[] = [
  { id: 'dashboard', href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', shortLabel: 'Dashboard', requiredCapability: 'dashboard.view' },
  { id: 'discover', href: '/discover', icon: Compass, label: 'Discover', shortLabel: 'Discover', requiredCapability: 'discover.view' },
  { id: 'anime', href: '/anime', icon: Sparkles, label: 'Anime', shortLabel: 'Anime', requiredCapability: 'anime.view' },
  { id: 'movies', href: '/movies', icon: Film, label: 'Movies', shortLabel: 'Movies', requiredCapability: 'movies.view' },
  { id: 'series', href: '/series', icon: Tv, label: 'TV Series', shortLabel: 'Series', requiredCapability: 'series.view' },
  { id: 'music', href: '/music', icon: Disc3, label: 'Music', shortLabel: 'Music', requiredCapability: 'music.view' },
  { id: 'watchlist', href: '/watchlist', icon: Bookmark, label: 'Watchlist', shortLabel: 'Watchlist', requiredCapability: 'watchlist.view' },
  { id: 'requests', href: '/requests', icon: Inbox, label: 'Requests', shortLabel: 'Requests', requiredCapability: 'requests.view', badgeArea: 'requests' },
  { id: 'random', href: '/random', icon: Dices, label: 'Random Watch', shortLabel: 'Random', requiredCapability: 'random.view' },
  { id: 'calendar', href: '/calendar', icon: CalendarDays, label: 'Calendar', shortLabel: 'Calendar', requiredCapability: 'calendar.view' },
  { id: 'library-gaps', href: '/library-gaps', icon: LibraryBig, label: 'Library Gaps', shortLabel: 'Gaps' },
  { id: 'torrents', href: '/torrents', icon: HardDrive, label: 'Torrents', shortLabel: 'Torrents', requiredCapability: 'torrents.view', badgeArea: 'downloads' },
  { id: 'cleanup', href: '/cleanup', icon: Sparkle, label: 'Cleanup', shortLabel: 'Cleanup', requiredCapability: 'cleanup.view' },
  { id: 'prowlarr', href: '/prowlarr', icon: Search, label: 'Prowlarr', shortLabel: 'Prowlarr', requiredCapability: 'prowlarr.view' },
  { id: 'jellyfin', href: '/jellyfin', icon: MonitorPlay, label: 'Jellyfin', shortLabel: 'Jellyfin', requiredCapability: 'jellyfin.view' },
  { id: 'insights', href: '/insights', icon: ChartLine, label: 'Insights', shortLabel: 'Insights', requiredCapability: 'insights.view' },
  { id: 'activity', href: '/activity', icon: Activity, label: 'Activity', shortLabel: 'Activity', requiredCapability: 'activity.view', badgeArea: 'activity' },
  { id: 'notifications', href: '/notifications', icon: Bell, label: 'Notifications', shortLabel: 'Alerts', requiredCapability: 'notifications.view', badgeArea: 'notifications' },
  { id: 'settings', href: '/settings', icon: Settings, label: 'Settings', shortLabel: 'Settings', pinned: true },
];

/** Default ID ordering */
export const DEFAULT_NAV_ORDER: NavItemId[] = NAV_ITEMS.map((item) => item.id);

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
