'use client';

import { useMemo } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  Activity,
  ArrowUpDown,
  BarChart,
  BarChart3,
  Bell,
  Calendar,
  CalendarDays,
  Clock,
  Database,
  Download,
  HardDrive,
  History,
  Layers,
  Library,
  MonitorPlay,
  PlayCircle,
  Search,
} from 'lucide-react';
import { getAllWidgetDefinitions } from '@/lib/widgets/registry';
import { useUIStore } from '@/lib/store';
import type { WidgetCategory } from '@/lib/widgets/types';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Activity,
  ArrowUpDown,
  BarChart,
  BarChart3,
  Bell,
  Calendar,
  CalendarDays,
  Clock,
  Database,
  Download,
  HardDrive,
  History,
  Layers,
  Library,
  MonitorPlay,
  PlayCircle,
  Search,
};

const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  overview: 'Overview',
  media: 'Media',
  downloads: 'Downloads',
  streaming: 'Streaming',
  monitoring: 'Monitoring',
};

const CATEGORY_ORDER: WidgetCategory[] = ['overview', 'media', 'downloads', 'streaming', 'monitoring'];

interface WidgetGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WidgetGallery({ open, onOpenChange }: WidgetGalleryProps) {
  const dashboardLayout = useUIStore((s) => s.dashboardLayout);
  const addWidget = useUIStore((s) => s.addWidget);

  const allDefinitions = getAllWidgetDefinitions();
  const addedWidgetIds = useMemo(
    () => new Set(dashboardLayout.map((w) => w.widgetId)),
    [dashboardLayout]
  );

  const grouped = useMemo(() => {
    const map = new Map<WidgetCategory, typeof allDefinitions>();
    for (const cat of CATEGORY_ORDER) {
      map.set(cat, []);
    }
    for (const def of allDefinitions) {
      map.get(def.category)?.push(def);
    }
    return map;
  }, [allDefinitions]);

  function handleAdd(widgetId: string) {
    const def = allDefinitions.find((d) => d.id === widgetId);
    if (!def) return;
    addWidget(widgetId, def.defaultSize);
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <DrawerTitle>Add Widget</DrawerTitle>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-8 space-y-5">
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
                        <div className="flex gap-1">
                          {def.sizes.map((s) => (
                            <span
                              key={s}
                              className="text-[9px] uppercase font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                            >
                              {s[0]}
                            </span>
                          ))}
                        </div>
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
