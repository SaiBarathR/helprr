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
    sizes: ['medium', 'large'],
    defaultSize: 'large',
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

export const DEFAULT_LAYOUT: WidgetInstance[] = [
  { id: 'stats-grid-1', widgetId: 'stats-grid', size: 'medium' },
  { id: 'prowlarr-indexers-1', widgetId: 'prowlarr-indexers', size: 'medium' },
  { id: 'now-streaming-1', widgetId: 'now-streaming', size: 'large' },
  { id: 'continue-watching-1', widgetId: 'continue-watching', size: 'large' },
  { id: 'active-downloads-1', widgetId: 'active-downloads', size: 'large' },
  { id: 'recently-added-1', widgetId: 'recently-added', size: 'large' },
  { id: 'upcoming-1', widgetId: 'upcoming', size: 'large' },
];
