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

// Default dashboard layout. Each row is sized from the widget's own
// `defaultDesktopSpan` in definitions.ts — editing that file automatically
// flows through to the reset/initial layout, so the two never drift.
//
// Row plan (12-col grid):
//   y=0  stats(4×2)            now-streaming(8×2)
//   y=2  prowlarr(3×1) torrent(3×2)  today(3×2)
//        wanted(3×1)
//   y=4  storage(4×2)           active-downloads(6×2)
//   y=6  service-health(4×3)    cleanup-status(4×3)  cleanup-history(4×3)
//   y=9  recently-added(6×3)    upcoming(6×3)
//   y=12 continue-watching(6×3)
//   y=15 activity-history(4×4)  notifications(4×4)
interface DefaultPosition {
  id: string;
  widgetId: string;
  x: number;
  y: number;
  mobileColSpan: number;
  mobileRowSpan: number;
}

const DEFAULT_POSITIONS: DefaultPosition[] = [
  // Hero (h=2)
  { id: 'stats-grid-1', widgetId: 'stats-grid', x: 0, y: 0, mobileColSpan: 2, mobileRowSpan: 1 },
  { id: 'now-streaming-1', widgetId: 'now-streaming', x: 4, y: 0, mobileColSpan: 2, mobileRowSpan: 1 },
  // Indicators (h=2)
  { id: 'prowlarr-indexers-1', widgetId: 'prowlarr-indexers', x: 0, y: 2, mobileColSpan: 1, mobileRowSpan: 1 },
  { id: 'wanted-items-1', widgetId: 'wanted-items', x: 0, y: 3, mobileColSpan: 1, mobileRowSpan: 1 },
  { id: 'torrent-overview-1', widgetId: 'torrent-overview', x: 3, y: 2, mobileColSpan: 1, mobileRowSpan: 1 },
  { id: 'today-calendar-1', widgetId: 'today-calendar', x: 6, y: 2, mobileColSpan: 2, mobileRowSpan: 1 },
  // Storage + Downloads (h=2)
  { id: 'storage-usage-1', widgetId: 'storage-usage', x: 0, y: 4, mobileColSpan: 1, mobileRowSpan: 1 },
  { id: 'active-downloads-1', widgetId: 'active-downloads', x: 4, y: 4, mobileColSpan: 2, mobileRowSpan: 1 },
  // Monitoring trio (h=3)
  { id: 'service-health-1', widgetId: 'service-health', x: 0, y: 6, mobileColSpan: 1, mobileRowSpan: 1 },
  { id: 'cleanup-status-1', widgetId: 'cleanup-status', x: 4, y: 6, mobileColSpan: 2, mobileRowSpan: 1 },
  { id: 'cleanup-history-1', widgetId: 'cleanup-history', x: 8, y: 6, mobileColSpan: 2, mobileRowSpan: 1 },
  // Big carousels (h=3)
  { id: 'recently-added-1', widgetId: 'recently-added', x: 0, y: 9, mobileColSpan: 2, mobileRowSpan: 1 },
  { id: 'upcoming-1', widgetId: 'upcoming', x: 6, y: 9, mobileColSpan: 2, mobileRowSpan: 1 },
  // Streaming (h=3)
  { id: 'continue-watching-1', widgetId: 'continue-watching', x: 0, y: 12, mobileColSpan: 2, mobileRowSpan: 1 },
  // Activity feeds (h=4)
  { id: 'activity-history-1', widgetId: 'activity-history', x: 0, y: 15, mobileColSpan: 2, mobileRowSpan: 1 },
  { id: 'notifications-1', widgetId: 'notifications', x: 4, y: 15, mobileColSpan: 2, mobileRowSpan: 1 },
];

export const DEFAULT_LAYOUT: WidgetInstance[] = DEFAULT_POSITIONS.map((pos) => {
  const def = staticMap.get(pos.widgetId);
  const span = def?.defaultDesktopSpan ?? { colSpan: 4, rowSpan: 2 };
  return {
    id: pos.id,
    widgetId: pos.widgetId,
    x: pos.x,
    y: pos.y,
    colSpan: span.colSpan,
    rowSpan: span.rowSpan,
    mobileColSpan: pos.mobileColSpan,
    mobileRowSpan: pos.mobileRowSpan,
  };
});
