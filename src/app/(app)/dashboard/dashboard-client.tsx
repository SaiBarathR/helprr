'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useUIStore } from '@/lib/store';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { WidgetGrid } from '@/components/widgets/widget-grid';
import { WidgetGallery } from '@/components/widgets/widget-gallery';
import { BentoTopBar, FloatingEdit, HPR } from '@/components/widgets/bento-primitives';
import { buildDashboardThemeStyle } from '@/lib/dashboard-theme';
import {
  DashboardLayoutProvider,
  useDashboardLayout,
} from '@/components/widgets/dashboard-layout-context';
import { LayoutSwitcher } from '@/components/widgets/layout-switcher';
import type { WidgetInstance } from '@/lib/widgets/types';

export interface InitialDashboardLayout {
  id: string;
  name: string;
  widgets: WidgetInstance[];
}

interface DashboardClientProps {
  initialLayout: InitialDashboardLayout;
  initialDevice: 'desktop' | 'mobile';
}

function setDeviceCookie(device: 'desktop' | 'mobile'): void {
  if (typeof document === 'undefined') return;
  const maxAge = 60 * 60 * 24 * 365; // 1 year
  document.cookie = `helprr-device=${device}; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

function FullPageSpinner() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: HPR.ink,
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: `3px solid ${HPR.hairline2}`,
          borderTopColor: HPR.amber,
          animation: 'helprr-spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes helprr-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function DashboardClient({ initialLayout, initialDevice }: DashboardClientProps) {
  // Keying on the layout id remounts the provider whenever the active layout
  // changes — the working set resets to the new layout's widgets without us
  // having to thread a "sync on prop change" effect through the provider.
  return (
    <DashboardLayoutProvider
      key={initialLayout.id}
      initialWidgets={initialLayout.widgets}
      activeLayoutId={initialLayout.id}
    >
      <DashboardInner initialLayout={initialLayout} initialDevice={initialDevice} />
    </DashboardLayoutProvider>
  );
}

function DashboardInner({ initialLayout, initialDevice }: DashboardClientProps) {
  const router = useRouter();
  const isMobile = useIsMobile(768);
  const detectedDevice: 'desktop' | 'mobile' = isMobile ? 'mobile' : 'desktop';
  const [reloading, setReloading] = useState(false);

  // Sync the cookie + reload when the detected device disagrees with what the
  // server rendered. matchMedia is null on first render (server-safe default),
  // so we wait until React commits before deciding.
  useEffect(() => {
    if (detectedDevice === initialDevice) {
      setDeviceCookie(detectedDevice);
      return;
    }
    setReloading(true);
    setDeviceCookie(detectedDevice);
    router.refresh();
  }, [detectedDevice, initialDevice, router]);

  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const editMode = useUIStore((s) => s.dashboardEditMode);
  const setEditMode = useUIStore((s) => s.setDashboardEditMode);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { widgets, isDirty, setWidgets } = useDashboardLayout();

  const accent = useUIStore((s) => s.dashboardAccent);
  const palette = useUIStore((s) => s.dashboardPalette);
  const gradient = useUIStore((s) => s.dashboardGradient);
  const font = useUIStore((s) => s.dashboardFont);

  const themeStyle = useMemo(
    () => buildDashboardThemeStyle({ accent, palette, gradient, font }),
    [accent, palette, gradient, font],
  );

  useEffect(() => {
    getRefreshIntervalMs('dashboardRefreshIntervalSecs', 5).then(setRefreshIntervalMs);
  }, []);

  useEffect(() => {
    return () => setEditMode(false);
  }, [setEditMode]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard-layouts/${initialLayout.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgets }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'Failed to save');
      }
      toast.success('Saved');
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save');
      return false;
    } finally {
      setSaving(false);
    }
  }, [initialLayout.id, widgets, router]);

  const handleDiscard = useCallback(() => {
    setWidgets(initialLayout.widgets);
  }, [initialLayout.widgets, setWidgets]);

  // "Done" commits pending edits before exiting. If the save fails we stay in
  // edit mode so the user can retry — otherwise their changes would silently
  // vanish on reload.
  const handleDone = useCallback(async () => {
    if (isDirty) {
      const ok = await handleSave();
      if (!ok) return;
    }
    setEditMode(false);
  }, [isDirty, handleSave, setEditMode]);

  const handleFloatingToggle = useCallback(() => {
    if (editMode) {
      void handleDone();
    } else {
      setEditMode(true);
    }
  }, [editMode, handleDone, setEditMode]);

  const handleLayoutSwitched = useCallback(() => {
    router.refresh();
  }, [router]);

  const eyebrow = `${initialLayout.name}${isDirty ? ' · unsaved changes' : ''}`;

  if (reloading) return <FullPageSpinner />;

  return (
    <div
      className="dashboard-bento"
      style={{
        ...themeStyle,
        margin: isMobile ? '-0.5rem -0.5rem -1rem' : '-1.5rem',
        padding: isMobile ? '0.5rem 0.75rem 5rem' : '1.25rem 1.75rem 3.5rem',
        minHeight: isMobile
          ? 'calc(100dvh - var(--header-height, 0px) - 4rem)'
          : '100%',
        visibility: hasHydrated ? 'visible' : 'hidden',
      }}
    >
      {editMode && (
        <BentoTopBar
          mobile={isMobile}
          edit={editMode}
          title="Editing dashboard"
          eyebrow={eyebrow}
          onAdd={() => setGalleryOpen(true)}
          onSwitch={() => setSwitcherOpen(true)}
          onSave={handleSave}
          onDiscard={handleDiscard}
          onDone={handleDone}
          saving={saving}
          dirty={isDirty}
        />
      )}
      <WidgetGrid refreshInterval={refreshIntervalMs} isMobile={isMobile} />

      <FloatingEdit edit={editMode} mobile={isMobile} onClick={handleFloatingToggle} />
      <WidgetGallery open={galleryOpen} onOpenChange={setGalleryOpen} />
      <LayoutSwitcher
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        activeLayoutId={initialLayout.id}
        device={detectedDevice}
        onLayoutSwitched={handleLayoutSwitched}
      />
    </div>
  );
}
