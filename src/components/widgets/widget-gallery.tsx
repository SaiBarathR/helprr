'use client';

import { useMemo, useState } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import {
  Activity,
  ArrowUpDown,
  BarChart,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CalendarDays,
  Clock,
  Database,
  Download,
  Film,
  Filter,
  HardDrive,
  History,
  Layers,
  Library,
  MonitorPlay,
  PlayCircle,
  Search,
  Server,
  ShieldAlert,
  Sparkles,
  Tags,
  Timer,
  Tv,
  Users,
  XCircle,
  Zap,
} from 'lucide-react';
import { getAllWidgetDefinitions } from '@/lib/widgets/registry';
import { useUIStore } from '@/lib/store';
import { useDashboardLayout } from './dashboard-layout-context';
import type { WidgetCategory } from '@/lib/widgets/types';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Activity,
  ArrowUpDown,
  BarChart,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CalendarDays,
  Clock,
  Database,
  Download,
  Film,
  Filter,
  HardDrive,
  History,
  Layers,
  Library,
  MonitorPlay,
  PlayCircle,
  Search,
  Server,
  ShieldAlert,
  Sparkles,
  Tags,
  Timer,
  Tv,
  Users,
  XCircle,
  Zap,
};

const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  overview: 'Overview',
  media: 'Media',
  downloads: 'Downloads',
  streaming: 'Streaming',
  monitoring: 'Monitoring',
  discover: 'Discover',
};

const CATEGORY_ORDER: WidgetCategory[] = ['overview', 'media', 'downloads', 'streaming', 'monitoring', 'discover'];

interface WidgetGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WidgetGallery({ open, onOpenChange }: WidgetGalleryProps) {
  const { widgets: dashboardLayout, addWidget } = useDashboardLayout();
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  const [query, setQuery] = useState('');

  // Reset the query when the caller closes the drawer. Wrapping
  // `onOpenChange` so we don't need an effect — calling setState inside an
  // effect that mirrors a prop triggers an immediate re-render.
  function handleOpenChange(next: boolean) {
    if (!next) setQuery('');
    onOpenChange(next);
  }

  const allDefinitions = useMemo(
    () => getAllWidgetDefinitions(discoverLayout),
    [discoverLayout]
  );
  const addedWidgetIds = useMemo(
    () => new Set(dashboardLayout.map((w) => w.widgetId)),
    [dashboardLayout]
  );

  const filteredDefinitions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allDefinitions;
    return allDefinitions.filter((def) =>
      def.name.toLowerCase().includes(q)
      || def.description.toLowerCase().includes(q)
    );
  }, [allDefinitions, query]);

  const grouped = useMemo(() => {
    const map = new Map<WidgetCategory, typeof allDefinitions>();
    for (const cat of CATEGORY_ORDER) {
      map.set(cat, []);
    }
    for (const def of filteredDefinitions) {
      map.get(def.category)?.push(def);
    }
    return map;
  }, [filteredDefinitions]);

  const noResults = query.trim() !== '' && filteredDefinitions.length === 0;

  function handleAdd(widgetId: string) {
    const def = allDefinitions.find((d) => d.id === widgetId);
    if (!def) return;
    addWidget(widgetId);
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Add Widget</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search widgets…"
              className="h-9 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-8 space-y-5">
          {noResults && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No widgets match &ldquo;{query.trim()}&rdquo;
            </p>
          )}
          {CATEGORY_ORDER.map((category) => {
            const widgets = grouped.get(category);
            if (!widgets || widgets.length === 0) return null;

            return (
              <div key={category}>
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                  {CATEGORY_LABELS[category]}
                </h3>
                <div className="space-y-2">
                  {widgets.map((def) => {
                    const isAdded = addedWidgetIds.has(def.id);
                    const Icon = ICON_MAP[def.icon];

                    return (
                      <button
                        key={def.id}
                        onClick={() => handleAdd(def.id)}
                        disabled={isAdded}
                        className={`w-full flex items-center gap-3 rounded-xl p-3 text-left transition-colors ${
                          isAdded
                            ? 'bg-muted/30 opacity-50'
                            : 'bg-card hover:bg-muted/30 active:bg-muted/50'
                        }`}
                      >
                        {Icon && <Icon className="h-5 w-5 text-muted-foreground shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{def.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{def.description}</p>
                        </div>
                        <span
                          className="text-[9px] uppercase font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                          title={`${def.defaultDesktopSpan.colSpan}×${def.defaultDesktopSpan.rowSpan} desktop`}
                        >
                          {def.defaultDesktopSpan.colSpan}×{def.defaultDesktopSpan.rowSpan}
                        </span>
                        {isAdded && (
                          <span className="text-[10px] text-muted-foreground font-medium">Added</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
