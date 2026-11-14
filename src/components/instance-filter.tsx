'use client';

import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterDot } from '@/components/ui/active-filter-bar';
import {
  ResponsiveMenu,
  ResponsiveMenuCheckboxItem,
} from '@/components/ui/responsive-menu';

export interface InstanceOption {
  id: string;
  label: string;
}

const APP_NAMES: Record<string, string> = {
  sonarr: 'Sonarr',
  radarr: 'Radarr',
  lidarr: 'Lidarr',
  prowlarr: 'Prowlarr',
  qbittorrent: 'qBittorrent',
  jellyfin: 'Jellyfin',
  seerr: 'Seerr',
  tmdb: 'TMDB',
  anilist: 'AniList',
};

/**
 * "main (Sonarr)": instances of different apps are often named alike. A label
 * that already names its app ("sonarr-anime") stays as it is.
 */
export function withAppName(label: string, type?: string): string {
  const app = type ? APP_NAMES[type.toLowerCase()] : undefined;
  if (!app) return label;
  // Older rows store the type itself ("SONARR") as the label.
  if (label.toLowerCase() === app.toLowerCase()) return app;
  if (label.toLowerCase().includes(app.toLowerCase())) return label;
  return `${label} (${app})`;
}

/**
 * Display names for the instances of apps that have more than one, by
 * instanceId: a row's "radarr" chip can't say which Radarr it came from.
 * Instances of an app with only one are left out, so their rows keep the plain
 * app chip.
 */
export function severalInstanceLabels(
  connections: ReadonlyArray<{ id: string; label: string; type: string }>,
): Map<string, string> {
  const perType = new Map<string, number>();
  for (const { type } of connections) perType.set(type, (perType.get(type) ?? 0) + 1);
  return new Map(connections
    .filter(({ type }) => (perType.get(type) ?? 0) > 1)
    .map(({ id, label, type }) => [id, withAppName(label, type)]));
}

/**
 * Collect the distinct instances present in an already-tagged list of items
 * (preserving first-seen order). Used to build the options for {@link InstanceFilter}.
 */
export function deriveInstances<T extends { instanceId?: string; instanceLabel?: string }>(
  items: T[],
  appOf?: (item: T) => string | undefined,
): InstanceOption[] {
  const map = new Map<string, string>();
  for (const item of items) {
    if (item.instanceId && !map.has(item.instanceId)) {
      map.set(item.instanceId, withAppName(item.instanceLabel ?? item.instanceId, appOf?.(item)));
    }
  }
  return Array.from(map, ([id, label]) => ({ id, label }));
}

/**
 * A compact "filter by instance" dropdown for aggregated views (calendar,
 * activity, history). Renders nothing unless there is more than one instance —
 * single-instance setups see no UI change. `value` is `'all'` or an instanceId.
 */
export function InstanceFilter({
  instances,
  value,
  onChange,
  align = 'end',
  compact = false,
}: {
  instances: InstanceOption[];
  value: string;
  onChange: (id: string) => void;
  align?: 'start' | 'center' | 'end';
  /** Icon only up to lg, for a crowded row that names the pick elsewhere. */
  compact?: boolean;
}) {
  if (instances.length <= 1) return null;

  const current = value === 'all' ? 'All instances' : (instances.find((i) => i.id === value)?.label ?? 'All instances');

  return (
    <ResponsiveMenu
      title="Instance"
      titleInDropdown
      closeOnPick
      align={align}
      trigger={(
        <Button
          variant="outline"
          size="sm"
          className="relative touch-target h-8 gap-1.5 px-2 sm:px-3"
          title={current}
          aria-label={`Instance: ${current}`}
        >
          <Layers className="h-3.5 w-3.5 shrink-0" />
          {/* Icon-only on mobile to avoid horizontal overflow; label shows from sm up
              (lg up when compact), and the dot marks a picked instance where the
              label is hidden. */}
          <span className={`hidden max-w-[10rem] truncate ${compact ? 'lg:inline' : 'sm:inline'}`}>{current}</span>
          <span className={compact ? 'lg:hidden' : 'sm:hidden'}><FilterDot active={value !== 'all'} /></span>
        </Button>
      )}
    >
      <ResponsiveMenuCheckboxItem checked={value === 'all'} onCheckedChange={() => onChange('all')}>
        All instances
      </ResponsiveMenuCheckboxItem>
      {instances.map((inst) => (
        <ResponsiveMenuCheckboxItem
          key={inst.id}
          checked={value === inst.id}
          onCheckedChange={() => onChange(inst.id)}
        >
          {inst.label}
        </ResponsiveMenuCheckboxItem>
      ))}
    </ResponsiveMenu>
  );
}
