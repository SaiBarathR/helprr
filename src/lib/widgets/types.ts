import type { ComponentType } from 'react';
import type { Capability } from '@/lib/capabilities';

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
  | 'vertical'
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
  /** True when rendered inside the mobile grid. Lets toggles persist their
   *  choice to the device-specific override field instead of clobbering the
   *  desktop variant. */
  mobileGrid?: boolean;
}

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon name
  category: WidgetCategory;
  defaultDesktopSpan: WidgetSpan;
  defaultMobileSpan: WidgetSpan;
  /** Per-type default poll interval (seconds). Each WidgetInstance may override
   *  via refreshIntervalSecs; otherwise this value is used. */
  defaultRefreshIntervalSecs: number;
  supportsNarrow?: boolean;
  /** Layout variant chosen when narrow=false (desktop or full-row mobile). */
  desktopLayout?: WidgetLayoutVariant;
  /** Layout variant chosen when narrow=true or row-stack is preferable. */
  mobileLayout?: WidgetLayoutVariant;
  component: ComponentType<WidgetProps>;
  requiredServices?: ('SONARR' | 'RADARR' | 'QBITTORRENT' | 'PROWLARR' | 'JELLYFIN' | 'TMDB' | 'SEERR')[];
  /** When set, the widget is hidden (dashboard + gallery) from users who lack
   *  this capability — so a member never sees cleanup/prowlarr/analytics tiles. */
  requiredCapability?: Capability;
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
  /** User-chosen variant for the DESKTOP grid. When set, takes precedence
   *  over WidgetDefinition.desktopLayout. Historically applied to both grids
   *  — kept that way on mobile only as a fallback when mobileLayoutOverride
   *  is absent, so existing saved layouts don't visually change. */
  layoutOverride?: WidgetLayoutVariant;
  /** User-chosen variant for the MOBILE grid. When set, takes precedence
   *  over both layoutOverride and WidgetDefinition.mobileLayout. */
  mobileLayoutOverride?: WidgetLayoutVariant;
  /** Per-instance refresh interval (seconds). When set, overrides the
   *  WidgetDefinition.defaultRefreshIntervalSecs. Valid range: 10–300. */
  refreshIntervalSecs?: number;
}
