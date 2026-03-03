import type { WidgetDefinition, WidgetInstance } from './types';
import { ALL_WIDGET_DEFINITIONS } from './definitions';

const widgetRegistry = new Map<string, WidgetDefinition>();

for (const def of ALL_WIDGET_DEFINITIONS) {
  widgetRegistry.set(def.id, def);
}

export function getWidgetDefinition(widgetId: string): WidgetDefinition | undefined {
  return widgetRegistry.get(widgetId);
}

export function getAllWidgetDefinitions(): WidgetDefinition[] {
  return ALL_WIDGET_DEFINITIONS;
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
