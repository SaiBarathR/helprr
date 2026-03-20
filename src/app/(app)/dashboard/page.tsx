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
    <div className="space-y-0 pt-2 animate-content-in">
      {/* Edit mode header */}
      {editMode && (
        <div className="flex items-center justify-between mb-3 px-0.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGalleryOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium active:scale-95 transition-transform"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Widget
            </button>
            <button
              onClick={resetLayout}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-muted text-muted-foreground text-xs font-medium active:scale-95 transition-transform"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
          <button
            onClick={() => setEditMode(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium active:scale-95 transition-transform"
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
          className="fixed bottom-20 right-4 z-40 w-10 h-10 rounded-full bg-card border border-border shadow-lg flex items-center justify-center active:scale-90 transition-transform"
        >
          <Pencil className="h-4 w-4 text-muted-foreground" />
        </button>
      )}

      <WidgetGallery open={galleryOpen} onOpenChange={setGalleryOpen} />
    </div>
  );
}
