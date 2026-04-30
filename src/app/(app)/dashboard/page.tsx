'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Check, RotateCcw } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { WidgetGrid } from '@/components/widgets/widget-grid';
import { WidgetGallery } from '@/components/widgets/widget-gallery';

export default function DashboardPage() {
  const editMode = useUIStore((s) => s.dashboardEditMode);
  const setEditMode = useUIStore((s) => s.setDashboardEditMode);
  const resetLayout = useUIStore((s) => s.resetDashboardLayout);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);
  const [galleryOpen, setGalleryOpen] = useState(false);

  useEffect(() => {
    getRefreshIntervalMs('dashboardRefreshIntervalSecs', 5).then(setRefreshIntervalMs);
  }, []);

  // Exit edit mode on navigation
  useEffect(() => {
    return () => setEditMode(false);
  }, [setEditMode]);

  return (
    <div className="relative space-y-0 pt-1">
      {/* Dashboard masthead — editorial */}
      {!editMode && (
        <div className="mb-4 flex items-end justify-between gap-3 px-0.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="marquee-dot" />
              <span className="tracked-caps text-[10px] text-muted-foreground/80">
                Now Showing
              </span>
            </div>
            <h1 className="font-display text-[28px] sm:text-[32px] leading-none tracking-[-0.03em] font-medium">
              Dashboard
            </h1>
          </div>
          <span className="hidden sm:inline-block tracked-caps text-[10px] text-muted-foreground/70 font-mono">
            Reel · 01
          </span>
        </div>
      )}

      {/* Edit mode chrome */}
      {editMode && (
        <div className="mb-4 flex items-center justify-between px-0.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGalleryOpen(true)}
              className="press-feedback projector-glow flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold tracking-tight"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Widget
            </button>
            <button
              onClick={resetLayout}
              className="press-feedback flex items-center gap-1 px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 text-[11px] font-medium transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
          <button
            onClick={() => setEditMode(false)}
            className="press-feedback flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-foreground text-background text-[11px] font-semibold tracking-tight"
          >
            <Check className="h-3.5 w-3.5" />
            Done
          </button>
        </div>
      )}

      <WidgetGrid refreshInterval={refreshIntervalMs} />

      {/* Floating edit button */}
      {!editMode && (
        <button
          onClick={() => setEditMode(true)}
          aria-label="Edit dashboard"
          className="press-feedback fixed bottom-20 md:bottom-6 right-4 z-40 w-11 h-11 rounded-full bg-card/90 backdrop-blur-md border border-border shadow-lg flex items-center justify-center hover:border-primary/40 hover:text-primary transition-colors"
        >
          <Pencil className="h-4 w-4 text-muted-foreground" />
        </button>
      )}

      <WidgetGallery open={galleryOpen} onOpenChange={setGalleryOpen} />
    </div>
  );
}
