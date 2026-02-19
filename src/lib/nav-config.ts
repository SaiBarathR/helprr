import {
  LayoutDashboard,
  Film,
  Tv,
  CalendarDays,
  HardDrive,
  Search,
  Activity,
  Bell,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export type NavItemId =
  | 'dashboard'
  | 'movies'
  | 'series'
  | 'calendar'
  | 'torrents'
  | 'prowlarr'
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
}

/** Master ordered array of all navigation items — single source of truth */
export const NAV_ITEMS: NavItemDef[] = [
  { id: 'dashboard', href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', shortLabel: 'Dashboard' },
  { id: 'movies', href: '/movies', icon: Film, label: 'Movies', shortLabel: 'Movies' },
  { id: 'series', href: '/series', icon: Tv, label: 'TV Series', shortLabel: 'Series' },
  { id: 'calendar', href: '/calendar', icon: CalendarDays, label: 'Calendar', shortLabel: 'Calendar' },
  { id: 'torrents', href: '/torrents', icon: HardDrive, label: 'Torrents', shortLabel: 'Torrents' },
  { id: 'prowlarr', href: '/prowlarr', icon: Search, label: 'Prowlarr', shortLabel: 'Prowlarr' },
  { id: 'activity', href: '/activity', icon: Activity, label: 'Activity', shortLabel: 'Activity' },
  { id: 'notifications', href: '/notifications', icon: Bell, label: 'Notifications', shortLabel: 'Alerts' },
  { id: 'settings', href: '/settings', icon: Settings, label: 'Settings', shortLabel: 'Settings', pinned: true },
];

/** Default ID ordering */
export const DEFAULT_NAV_ORDER: NavItemId[] = NAV_ITEMS.map((item) => item.id);

/** ID → NavItemDef lookup */
export const NAV_ITEM_MAP: Record<NavItemId, NavItemDef> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.id, item])
) as Record<NavItemId, NavItemDef>;

/** Returns ordered, filtered nav items based on user preferences */
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

/** Splits enabled items into bottom nav tabs (first 4) and more menu (rest) */
export function getBottomNavLayout(enabledItems: NavItemDef[]) {
  return {
    tabs: enabledItems.slice(0, 4),
    moreItems: enabledItems.slice(4),
  };
}

/** Reconciles persisted order with current NAV_ITEMS — handles additions/removals */
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
