import type { ComponentType } from 'react';

export type ColSpan = number;
export type RowSpan = number;

export interface WidgetSpan {
  colSpan: ColSpan;
  rowSpan: RowSpan;
}

export type WidgetCategory =
  | 'overview'
  | 'media'
  | 'downloads'
  | 'streaming'
  | 'monitoring'
  | 'discover';

export type WidgetLayoutVariant =
  | 'carousel'
  | 'list'
  | 'posters'
  | 'cards'
  | 'detailed'
  | 'default';

export interface WidgetProps {
  refreshInterval: number;
  editMode?: boolean;
  narrow?: boolean;
  layoutVariant?: WidgetLayoutVariant;
  /** Effective column span on the current grid (1..12). */
  colSpan?: number;
  /** Effective row span. */
  rowSpan?: number;
  /** The WidgetInstance.id this render came from — needed to dispatch
   *  per-instance mutations like the view-mode toggle. */
  instanceId?: string;
}

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon name
  category: WidgetCategory;
  defaultDesktopSpan: WidgetSpan;
  defaultMobileSpan: WidgetSpan;
  supportsNarrow?: boolean;
  /** Layout variant chosen when narrow=false (desktop or full-row mobile). */
  desktopLayout?: WidgetLayoutVariant;
  /** Layout variant chosen when narrow=true or row-stack is preferable. */
  mobileLayout?: WidgetLayoutVariant;
  component: ComponentType<WidgetProps>;
  requiredServices?: ('SONARR' | 'RADARR' | 'QBITTORRENT' | 'PROWLARR' | 'JELLYFIN' | 'TMDB')[];
}

export interface WidgetInstance {
  id: string; // unique instance id (e.g. "stats-grid-1")
  widgetId: string; // references WidgetDefinition.id
  /** Desktop grid position, in 12-column layout coordinates. */
  x?: number;
  y?: number;
  colSpan: ColSpan;
  rowSpan: RowSpan;
  /** Optional mobile-specific overrides; falls back to definition defaults. */
  mobileColSpan?: ColSpan;
  mobileRowSpan?: RowSpan;
  /** Mobile grid position, in 4-column layout coordinates. */
  mobileX?: number;
  mobileY?: number;
  /** User-chosen variant for this widget on this layout. When set, takes
   *  precedence over the WidgetDefinition.desktopLayout/mobileLayout default. */
  layoutOverride?: WidgetLayoutVariant;
}
