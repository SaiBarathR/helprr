export type NavPageId =
  | 'dashboard'
  | 'movies'
  | 'series'
  | 'calendar'
  | 'torrents'
  | 'prowlarr'
  | 'activity'
  | 'notifications';

export type NavItemId = NavPageId | 'settings';

export type NavIconKey =
  | 'layoutDashboard'
  | 'film'
  | 'tv'
  | 'calendarDays'
  | 'hardDrive'
  | 'search'
  | 'activity'
  | 'bell'
  | 'settings';

export interface NavItemDefinition {
  id: NavItemId;
  href: string;
  label: string;
  iconKey: NavIconKey;
}

export interface NavConfigV1 {
  version: 1;
  order: NavPageId[];
  enabled: Record<NavPageId, boolean>;
}

export interface EffectiveNav {
  sidebarItems: NavItemDefinition[];
  bottomItems: NavItemDefinition[];
  moreItems: NavItemDefinition[];
  fallbackHref: string;
}

export const CONFIGURABLE_NAV_PAGE_IDS: NavPageId[] = [
  'dashboard',
  'movies',
  'series',
  'calendar',
  'torrents',
  'prowlarr',
  'activity',
  'notifications',
];

export const NAV_SETTINGS_ITEM: NavItemDefinition = {
  id: 'settings',
  href: '/settings',
  label: 'Settings',
  iconKey: 'settings',
};

const NAV_ITEMS: Record<NavItemId, NavItemDefinition> = {
  dashboard: {
    id: 'dashboard',
    href: '/dashboard',
    label: 'Dashboard',
    iconKey: 'layoutDashboard',
  },
  movies: {
    id: 'movies',
    href: '/movies',
    label: 'Movies',
    iconKey: 'film',
  },
  series: {
    id: 'series',
    href: '/series',
    label: 'TV Series',
    iconKey: 'tv',
  },
  calendar: {
    id: 'calendar',
    href: '/calendar',
    label: 'Calendar',
    iconKey: 'calendarDays',
  },
  torrents: {
    id: 'torrents',
    href: '/torrents',
    label: 'Torrents',
    iconKey: 'hardDrive',
  },
  prowlarr: {
    id: 'prowlarr',
    href: '/prowlarr',
    label: 'Prowlarr',
    iconKey: 'search',
  },
  activity: {
    id: 'activity',
    href: '/activity',
    label: 'Activity',
    iconKey: 'activity',
  },
  notifications: {
    id: 'notifications',
    href: '/notifications',
    label: 'Notifications',
    iconKey: 'bell',
  },
  settings: NAV_SETTINGS_ITEM,
};

const DEFAULT_ENABLED: Record<NavPageId, boolean> = {
  dashboard: true,
  movies: true,
  series: true,
  calendar: true,
  torrents: true,
  prowlarr: true,
  activity: true,
  notifications: true,
};

export const DEFAULT_NAV_CONFIG: NavConfigV1 = {
  version: 1,
  order: [...CONFIGURABLE_NAV_PAGE_IDS],
  enabled: { ...DEFAULT_ENABLED },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNavPageId(value: unknown): value is NavPageId {
  return typeof value === 'string' && CONFIGURABLE_NAV_PAGE_IDS.includes(value as NavPageId);
}

function normalizeOrder(order: unknown): NavPageId[] {
  const result: NavPageId[] = [];

  if (Array.isArray(order)) {
    for (const entry of order) {
      if (!isNavPageId(entry)) continue;
      if (!result.includes(entry)) {
        result.push(entry);
      }
    }
  }

  for (const id of CONFIGURABLE_NAV_PAGE_IDS) {
    if (!result.includes(id)) {
      result.push(id);
    }
  }

  return result;
}

function normalizeEnabled(enabled: unknown): Record<NavPageId, boolean> {
  const result: Record<NavPageId, boolean> = { ...DEFAULT_ENABLED };

  if (!isRecord(enabled)) return result;

  for (const id of CONFIGURABLE_NAV_PAGE_IDS) {
    const value = enabled[id];
    if (typeof value === 'boolean') {
      result[id] = value;
    }
  }

  return result;
}

export function normalizeNavConfig(raw: unknown): NavConfigV1 {
  if (!isRecord(raw)) {
    return {
      version: 1,
      order: [...DEFAULT_NAV_CONFIG.order],
      enabled: { ...DEFAULT_NAV_CONFIG.enabled },
    };
  }

  return {
    version: 1,
    order: normalizeOrder(raw.order),
    enabled: normalizeEnabled(raw.enabled),
  };
}

export function validateNavConfigInput(raw: unknown):
  | { valid: true; config: NavConfigV1 }
  | { valid: false; error: string } {
  if (!isRecord(raw)) {
    return { valid: false, error: 'navConfig must be an object' };
  }

  if ('version' in raw && raw.version !== 1) {
    return { valid: false, error: 'navConfig version is invalid' };
  }

  if ('order' in raw) {
    if (!Array.isArray(raw.order)) {
      return { valid: false, error: 'navConfig.order must be an array' };
    }

    for (const id of raw.order) {
      if (typeof id !== 'string') {
        return { valid: false, error: 'navConfig.order must contain strings' };
      }
    }
  }

  if ('enabled' in raw) {
    if (!isRecord(raw.enabled)) {
      return { valid: false, error: 'navConfig.enabled must be an object' };
    }

    for (const [key, value] of Object.entries(raw.enabled)) {
      if (!isNavPageId(key)) continue;
      if (typeof value !== 'boolean') {
        return { valid: false, error: `navConfig.enabled.${key} must be a boolean` };
      }
    }
  }

  return {
    valid: true,
    config: normalizeNavConfig(raw),
  };
}

export function getNavItem(id: NavItemId): NavItemDefinition {
  return NAV_ITEMS[id];
}

export function getConfigurableNavItems(order?: NavPageId[]): NavItemDefinition[] {
  const normalizedOrder = order ? normalizeOrder(order) : [...DEFAULT_NAV_CONFIG.order];
  return normalizedOrder.map((id) => NAV_ITEMS[id]);
}

export function isNavItemActive(pathname: string, item: Pick<NavItemDefinition, 'href'>): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function resolveConfigurableNavPageForPath(pathname: string): NavPageId | null {
  for (const id of CONFIGURABLE_NAV_PAGE_IDS) {
    const item = NAV_ITEMS[id];
    if (isNavItemActive(pathname, item)) {
      return id;
    }
  }

  return null;
}

export function buildEffectiveNav(configRaw: unknown, maxBottomItems = 4): EffectiveNav {
  const config = normalizeNavConfig(configRaw);
  const enabledOrderedConfigurableItems = config.order
    .filter((id) => config.enabled[id])
    .map((id) => NAV_ITEMS[id]);

  const sidebarItems = [...enabledOrderedConfigurableItems, NAV_SETTINGS_ITEM];
  const bottomItems = sidebarItems.slice(0, maxBottomItems);
  const moreItems = sidebarItems.slice(maxBottomItems);

  return {
    sidebarItems,
    bottomItems,
    moreItems,
    fallbackHref: enabledOrderedConfigurableItems[0]?.href ?? NAV_SETTINGS_ITEM.href,
  };
}
