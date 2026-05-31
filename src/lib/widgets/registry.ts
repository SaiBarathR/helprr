import * as React from 'react';
import type { ComponentType } from 'react';
import type { WidgetDefinition, WidgetInstance, WidgetProps } from './types';
import { ALL_WIDGET_DEFINITIONS } from './definitions';
import {
  BUILTIN_DISCOVER_SECTIONS,
  type DiscoverLayoutConfig,
  type DiscoverLayoutSection,
} from '@/lib/discover-layout-config';
import { DiscoverSectionWidget } from '@/components/widgets/discover-section-widget';

const staticMap = new Map<string, WidgetDefinition>();

for (const def of ALL_WIDGET_DEFINITIONS) {
  staticMap.set(def.id, def);
}

const BUILTIN_MAP = new Map(BUILTIN_DISCOVER_SECTIONS.map((s) => [s.id, s] as const));

const DISCOVER_WIDGET_PREFIX = 'discover-';

function iconForSection(section: DiscoverLayoutSection): string {
  if (section.type === 'custom') return 'Filter';
  const builtin = BUILTIN_MAP.get(section.id);
  if (!builtin) return 'Sparkles';
  if (builtin.sectionType === 'genre') return 'Tags';
  if (builtin.sectionType === 'provider') return 'Building2';
  return 'Sparkles';
}

function descriptionForSection(section: DiscoverLayoutSection): string {
  if (section.type === 'custom') return 'Custom Discover carousel';
  const builtin = BUILTIN_MAP.get(section.id);
  if (!builtin) return 'Discover section';
  if (builtin.sectionType === 'genre') return 'Discover genre grid';
  if (builtin.sectionType === 'provider') return 'Discover providers grid';
  return 'Discover carousel';
}

const sectionComponentCache = new Map<string, ComponentType<WidgetProps>>();

function getSectionComponent(sectionId: string): ComponentType<WidgetProps> {
  let cached = sectionComponentCache.get(sectionId);
  if (!cached) {
    cached = (props: WidgetProps) =>
      React.createElement(DiscoverSectionWidget, { sectionId, ...props });
    sectionComponentCache.set(sectionId, cached);
  }
  return cached;
}

function buildDefinitionForSection(section: DiscoverLayoutSection): WidgetDefinition {
  const sectionId = section.id;
  return {
    id: `${DISCOVER_WIDGET_PREFIX}${sectionId}`,
    name: section.label,
    description: descriptionForSection(section),
    icon: iconForSection(section),
    category: 'discover',
    defaultDesktopSpan: { colSpan: 12, rowSpan: 3 },
    defaultMobileSpan: { colSpan: 2, rowSpan: 1 },
    defaultRefreshIntervalSecs: 300,
    desktopLayout: 'carousel',
    mobileLayout: 'carousel',
    component: getSectionComponent(sectionId),
    requiredServices: ['TMDB'],
  };
}

export function buildDiscoverWidgetDefinitions(
  discoverLayout?: DiscoverLayoutConfig | null,
): WidgetDefinition[] {
  if (!discoverLayout?.sections?.length) return [];
  return discoverLayout.sections.map(buildDefinitionForSection);
}

export function getWidgetDefinition(
  widgetId: string,
  discoverLayout?: DiscoverLayoutConfig | null,
): WidgetDefinition | undefined {
  const fromStatic = staticMap.get(widgetId);
  if (fromStatic) return fromStatic;
  if (!widgetId.startsWith(DISCOVER_WIDGET_PREFIX)) return undefined;
  if (!discoverLayout?.sections?.length) return undefined;
  const sectionId = widgetId.slice(DISCOVER_WIDGET_PREFIX.length);
  const section = discoverLayout.sections.find((s) => s.id === sectionId);
  if (!section) return undefined;
  return buildDefinitionForSection(section);
}

export function getAllWidgetDefinitions(
  discoverLayout?: DiscoverLayoutConfig | null,
): WidgetDefinition[] {
  return [...ALL_WIDGET_DEFINITIONS, ...buildDiscoverWidgetDefinitions(discoverLayout)];
}

// Default dashboard layouts. Two distinct seed layouts:
//   - DEFAULT_DESKTOP_LAYOUT: optimised for the 12-column desktop grid
//   - DEFAULT_MOBILE_LAYOUT: optimised for the 4-column mobile grid
//
// Each position may override colSpan/rowSpan to fit the target grid cleanly.
// Indicator widgets (overview / prowlarr / wanted / torrents / today /
// service-health / storage) use the 'vertical' layout variant when packed into
// short cells so they render as a stacked icon/value/label.
interface DefaultPosition {
  id: string;
  widgetId: string;
  // Desktop coords + spans.
  x: number;
  y: number;
  colSpan?: number;
  rowSpan?: number;
  // Mobile coords + spans.
  mobileX: number;
  mobileY: number;
  mobileColSpan: number;
  mobileRowSpan: number;
  // Desktop variant override. Also acts as the mobile fallback when
  // mobileLayoutOverride is absent.
  layoutOverride?: WidgetInstance['layoutOverride'];
  // Mobile variant override. Wins over layoutOverride on the mobile grid.
  mobileLayoutOverride?: WidgetInstance['mobileLayoutOverride'];
}

// ── Desktop default ──
// User-curated arrangement (Desktop_final).
const DEFAULT_DESKTOP_POSITIONS: DefaultPosition[] = [
  { id: 'stats-grid-1', widgetId: 'stats-grid', x: 0, y: 0, colSpan: 4, rowSpan: 2,
    mobileX: 0, mobileY: 0, mobileColSpan: 4, mobileRowSpan: 1, layoutOverride: 'default' },
  { id: 'now-streaming-1', widgetId: 'now-streaming', x: 4, y: 0, colSpan: 8, rowSpan: 2,
    mobileX: 0, mobileY: 1, mobileColSpan: 4, mobileRowSpan: 2 },

  { id: 'prowlarr-indexers-1', widgetId: 'prowlarr-indexers', x: 0, y: 2, colSpan: 4, rowSpan: 1,
    mobileX: 0, mobileY: 3, mobileColSpan: 2, mobileRowSpan: 1, layoutOverride: 'default' },
  { id: 'wanted-items-1', widgetId: 'wanted-items', x: 4, y: 2, colSpan: 4, rowSpan: 1,
    mobileX: 2, mobileY: 3, mobileColSpan: 2, mobileRowSpan: 1, layoutOverride: 'default' },
  { id: 'torrent-overview-1', widgetId: 'torrent-overview', x: 8, y: 2, colSpan: 4, rowSpan: 1,
    mobileX: 0, mobileY: 4, mobileColSpan: 2, mobileRowSpan: 1, layoutOverride: 'vertical' },

  { id: 'activity-history-1', widgetId: 'activity-history', x: 0, y: 3, colSpan: 6, rowSpan: 3,
    mobileX: 0, mobileY: 25, mobileColSpan: 4, mobileRowSpan: 4, layoutOverride: 'list' },
  { id: 'today-calendar-1', widgetId: 'today-calendar', x: 6, y: 3, colSpan: 6, rowSpan: 3,
    mobileX: 2, mobileY: 4, mobileColSpan: 2, mobileRowSpan: 1, layoutOverride: 'carousel' },

  { id: 'active-downloads-1', widgetId: 'active-downloads', x: 0, y: 6, colSpan: 12, rowSpan: 2,
    mobileX: 0, mobileY: 7, mobileColSpan: 4, mobileRowSpan: 2, layoutOverride: 'carousel' },

  { id: 'service-health-1', widgetId: 'service-health', x: 0, y: 8, colSpan: 4, rowSpan: 3,
    mobileX: 0, mobileY: 9, mobileColSpan: 4, mobileRowSpan: 3 },
  { id: 'cleanup-status-1', widgetId: 'cleanup-status', x: 4, y: 8, colSpan: 4, rowSpan: 3,
    mobileX: 0, mobileY: 12, mobileColSpan: 4, mobileRowSpan: 2 },
  { id: 'cleanup-history-1', widgetId: 'cleanup-history', x: 8, y: 8, colSpan: 4, rowSpan: 3,
    mobileX: 0, mobileY: 14, mobileColSpan: 4, mobileRowSpan: 2 },

  { id: 'recently-added-1', widgetId: 'recently-added', x: 0, y: 11, colSpan: 12, rowSpan: 3,
    mobileX: 0, mobileY: 16, mobileColSpan: 4, mobileRowSpan: 3, layoutOverride: 'carousel' },
  { id: 'upcoming-1', widgetId: 'upcoming', x: 0, y: 14, colSpan: 12, rowSpan: 3,
    mobileX: 0, mobileY: 19, mobileColSpan: 4, mobileRowSpan: 3 },

  { id: 'jellyfin-server-1', widgetId: 'jellyfin-server', x: 0, y: 17, colSpan: 5, rowSpan: 2,
    mobileX: 0, mobileY: 22, mobileColSpan: 2, mobileRowSpan: 2 },
  { id: 'jellyfin-scheduled-tasks-1', widgetId: 'jellyfin-scheduled-tasks', x: 5, y: 17, colSpan: 7, rowSpan: 4,
    mobileX: 2, mobileY: 22, mobileColSpan: 2, mobileRowSpan: 3 },

  { id: 'prowlarr-stats-summary-1', widgetId: 'prowlarr-stats-summary', x: 0, y: 19, colSpan: 5, rowSpan: 2,
    mobileX: 0, mobileY: 24, mobileColSpan: 2, mobileRowSpan: 1 },
  { id: 'prowlarr-failure-rate-1', widgetId: 'prowlarr-failure-rate', x: 0, y: 21, colSpan: 5, rowSpan: 2,
    mobileX: 0, mobileY: 5, mobileColSpan: 2, mobileRowSpan: 2 },
  { id: 'prowlarr-grabs-by-indexer-1', widgetId: 'prowlarr-grabs-by-indexer', x: 0, y: 23, colSpan: 5, rowSpan: 2,
    mobileX: 2, mobileY: 5, mobileColSpan: 2, mobileRowSpan: 2 },

  { id: 'notifications-1', widgetId: 'notifications', x: 5, y: 21, colSpan: 7, rowSpan: 4,
    mobileX: 0, mobileY: 29, mobileColSpan: 4, mobileRowSpan: 4 },
];

// ── Mobile default ──
// User-curated arrangement (Mobile_final). Distinct positions/overrides
// from the desktop default, tuned for the 4-col mobile grid.
const DEFAULT_MOBILE_POSITIONS: DefaultPosition[] = [
  { id: 'stats-grid-1', widgetId: 'stats-grid', x: 0, y: 0, colSpan: 4, rowSpan: 2,
    mobileX: 0, mobileY: 0, mobileColSpan: 4, mobileRowSpan: 1, layoutOverride: 'default' },
  { id: 'today-calendar-1', widgetId: 'today-calendar', x: 4, y: 0, colSpan: 3, rowSpan: 2,
    mobileX: 0, mobileY: 4, mobileColSpan: 4, mobileRowSpan: 3, layoutOverride: 'list' },
  { id: 'jellyfin-server-1', widgetId: 'jellyfin-server', x: 7, y: 0, colSpan: 4, rowSpan: 2,
    mobileX: 0, mobileY: 21, mobileColSpan: 4, mobileRowSpan: 2 },

  { id: 'torrent-overview-1', widgetId: 'torrent-overview', x: 3, y: 2, colSpan: 3, rowSpan: 2,
    mobileX: 0, mobileY: 1, mobileColSpan: 2, mobileRowSpan: 1 },
  { id: 'prowlarr-indexers-1', widgetId: 'prowlarr-indexers', x: 0, y: 2, colSpan: 3, rowSpan: 1,
    mobileX: 2, mobileY: 1, mobileColSpan: 1, mobileRowSpan: 1 },
  { id: 'wanted-items-1', widgetId: 'wanted-items', x: 0, y: 3, colSpan: 3, rowSpan: 1,
    mobileX: 3, mobileY: 1, mobileColSpan: 1, mobileRowSpan: 1 },

  { id: 'now-streaming-1', widgetId: 'now-streaming', x: 0, y: 12, colSpan: 8, rowSpan: 2,
    mobileX: 0, mobileY: 2, mobileColSpan: 2, mobileRowSpan: 2, layoutOverride: 'carousel' },
  { id: 'active-downloads-1', widgetId: 'active-downloads', x: 4, y: 4, colSpan: 6, rowSpan: 2,
    mobileX: 2, mobileY: 2, mobileColSpan: 2, mobileRowSpan: 2 },

  { id: 'activity-history-1', widgetId: 'activity-history', x: 0, y: 15, colSpan: 4, rowSpan: 4,
    mobileX: 0, mobileY: 7, mobileColSpan: 4, mobileRowSpan: 3,
    layoutOverride: 'list', mobileLayoutOverride: 'list' },
  { id: 'recently-added-1', widgetId: 'recently-added', x: 6, y: 9, colSpan: 6, rowSpan: 3,
    mobileX: 0, mobileY: 10, mobileColSpan: 4, mobileRowSpan: 3,
    layoutOverride: 'carousel', mobileLayoutOverride: 'carousel' },
  { id: 'upcoming-1', widgetId: 'upcoming', x: 0, y: 9, colSpan: 6, rowSpan: 3,
    mobileX: 0, mobileY: 13, mobileColSpan: 4, mobileRowSpan: 3,
    layoutOverride: 'carousel', mobileLayoutOverride: 'carousel' },

  { id: 'cleanup-status-1', widgetId: 'cleanup-status', x: 4, y: 6, colSpan: 4, rowSpan: 3,
    mobileX: 0, mobileY: 16, mobileColSpan: 4, mobileRowSpan: 3 },
  { id: 'cleanup-history-1', widgetId: 'cleanup-history', x: 8, y: 6, colSpan: 4, rowSpan: 3,
    mobileX: 0, mobileY: 19, mobileColSpan: 4, mobileRowSpan: 2 },

  { id: 'jellyfin-scheduled-tasks-1', widgetId: 'jellyfin-scheduled-tasks', x: 0, y: 19, colSpan: 6, rowSpan: 4,
    mobileX: 0, mobileY: 23, mobileColSpan: 4, mobileRowSpan: 3 },

  { id: 'storage-usage-1', widgetId: 'storage-usage', x: 0, y: 4, colSpan: 4, rowSpan: 2,
    mobileX: 2, mobileY: 26, mobileColSpan: 2, mobileRowSpan: 2 },
  { id: 'service-health-1', widgetId: 'service-health', x: 0, y: 6, colSpan: 4, rowSpan: 3,
    mobileX: 0, mobileY: 26, mobileColSpan: 2, mobileRowSpan: 2, layoutOverride: 'default' },

  { id: 'notifications-1', widgetId: 'notifications', x: 4, y: 15, colSpan: 4, rowSpan: 4,
    mobileX: 0, mobileY: 28, mobileColSpan: 4, mobileRowSpan: 4 },
];

function buildLayout(positions: DefaultPosition[]): WidgetInstance[] {
  return positions.map((pos) => {
    const def = staticMap.get(pos.widgetId);
    const span = def?.defaultDesktopSpan ?? { colSpan: 4, rowSpan: 2 };
    const instance: WidgetInstance = {
      id: pos.id,
      widgetId: pos.widgetId,
      x: pos.x,
      y: pos.y,
      colSpan: pos.colSpan ?? span.colSpan,
      rowSpan: pos.rowSpan ?? span.rowSpan,
      mobileX: pos.mobileX,
      mobileY: pos.mobileY,
      mobileColSpan: pos.mobileColSpan,
      mobileRowSpan: pos.mobileRowSpan,
    };
    if (pos.layoutOverride) instance.layoutOverride = pos.layoutOverride;
    if (pos.mobileLayoutOverride) instance.mobileLayoutOverride = pos.mobileLayoutOverride;
    return instance;
  });
}

// ── Member default ──
// Simple starter layout for member accounts: only widgets a member can access
// (library, discover, their own requests, read-only torrents/activity). Each
// member gets a personal copy on first dashboard load and can customize it.
const DEFAULT_MEMBER_POSITIONS: DefaultPosition[] = [
  { id: 'm-stats-grid-1', widgetId: 'stats-grid', x: 0, y: 0, colSpan: 4, rowSpan: 2,
    mobileX: 0, mobileY: 0, mobileColSpan: 4, mobileRowSpan: 1, layoutOverride: 'default' },
  { id: 'm-continue-watching-1', widgetId: 'continue-watching', x: 4, y: 0, colSpan: 8, rowSpan: 2,
    mobileX: 0, mobileY: 1, mobileColSpan: 4, mobileRowSpan: 2, layoutOverride: 'carousel' },
  { id: 'm-seerr-recent-requests-1', widgetId: 'seerr-recent-requests', x: 0, y: 2, colSpan: 6, rowSpan: 3,
    mobileX: 0, mobileY: 3, mobileColSpan: 4, mobileRowSpan: 3, layoutOverride: 'list' },
  { id: 'm-activity-history-1', widgetId: 'activity-history', x: 6, y: 2, colSpan: 6, rowSpan: 3,
    mobileX: 0, mobileY: 6, mobileColSpan: 4, mobileRowSpan: 3, layoutOverride: 'list' },
  { id: 'm-recently-added-1', widgetId: 'recently-added', x: 0, y: 5, colSpan: 12, rowSpan: 3,
    mobileX: 0, mobileY: 9, mobileColSpan: 4, mobileRowSpan: 3, layoutOverride: 'carousel' },
  { id: 'm-upcoming-1', widgetId: 'upcoming', x: 0, y: 8, colSpan: 12, rowSpan: 3,
    mobileX: 0, mobileY: 12, mobileColSpan: 4, mobileRowSpan: 3, layoutOverride: 'carousel' },
  { id: 'm-today-calendar-1', widgetId: 'today-calendar', x: 0, y: 11, colSpan: 6, rowSpan: 3,
    mobileX: 0, mobileY: 15, mobileColSpan: 4, mobileRowSpan: 2, layoutOverride: 'carousel' },
  { id: 'm-for-you-1', widgetId: 'for-you', x: 6, y: 11, colSpan: 6, rowSpan: 3,
    mobileX: 0, mobileY: 17, mobileColSpan: 4, mobileRowSpan: 3, layoutOverride: 'carousel' },
  { id: 'm-active-downloads-1', widgetId: 'active-downloads', x: 0, y: 14, colSpan: 8, rowSpan: 2,
    mobileX: 0, mobileY: 20, mobileColSpan: 4, mobileRowSpan: 2, layoutOverride: 'carousel' },
  { id: 'm-torrent-overview-1', widgetId: 'torrent-overview', x: 8, y: 14, colSpan: 4, rowSpan: 2,
    mobileX: 0, mobileY: 22, mobileColSpan: 2, mobileRowSpan: 1, layoutOverride: 'vertical' },
  { id: 'm-notifications-1', widgetId: 'notifications', x: 0, y: 16, colSpan: 12, rowSpan: 3,
    mobileX: 0, mobileY: 23, mobileColSpan: 4, mobileRowSpan: 3 },
];

export const DEFAULT_DESKTOP_LAYOUT: WidgetInstance[] = buildLayout(DEFAULT_DESKTOP_POSITIONS);
export const DEFAULT_MOBILE_LAYOUT: WidgetInstance[] = buildLayout(DEFAULT_MOBILE_POSITIONS);
// One position set serves both member grids — each position carries its mobile
// coords/spans, so the 4-col mobile grid is driven by the same array.
export const DEFAULT_MEMBER_DESKTOP_LAYOUT: WidgetInstance[] = buildLayout(DEFAULT_MEMBER_POSITIONS);
export const DEFAULT_MEMBER_MOBILE_LAYOUT: WidgetInstance[] = buildLayout(DEFAULT_MEMBER_POSITIONS);

// Back-compat alias for any code still importing the old name.
export const DEFAULT_LAYOUT: WidgetInstance[] = DEFAULT_DESKTOP_LAYOUT;

export type DashboardLayoutSlug = 'desktop' | 'mobile';

export function getDefaultLayoutForSlug(slug: DashboardLayoutSlug): WidgetInstance[] {
  return slug === 'mobile' ? DEFAULT_MOBILE_LAYOUT : DEFAULT_DESKTOP_LAYOUT;
}
