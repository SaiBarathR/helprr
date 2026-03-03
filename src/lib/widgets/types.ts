import type { ComponentType } from 'react';

export type WidgetSize = 'small' | 'medium' | 'large';

export type WidgetCategory = 'overview' | 'media' | 'downloads' | 'streaming' | 'monitoring';

export interface WidgetProps {
  size: WidgetSize;
  refreshInterval: number;
}

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon name
  category: WidgetCategory;
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
  component: ComponentType<WidgetProps>;
  requiredServices?: ('SONARR' | 'RADARR' | 'QBITTORRENT' | 'PROWLARR' | 'JELLYFIN')[];
}

export interface WidgetInstance {
  id: string; // unique instance id (e.g. "stats-grid-1")
  widgetId: string; // references WidgetDefinition.id
  size: WidgetSize;
}
