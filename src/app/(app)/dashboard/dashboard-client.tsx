'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useUIStore } from '@/lib/store';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { WidgetGrid } from '@/components/widgets/widget-grid';
import { WidgetGallery } from '@/components/widgets/widget-gallery';
import { RefreshIntervalDrawer } from '@/components/widgets/refresh-interval-drawer';
import { BentoTopBar, FloatingEdit, HPR } from '@/components/widgets/bento-primitives';
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
  isBuiltIn: boolean;
}

interface DashboardClientProps {
  initialLayout: InitialDashboardLayout;
  initialDevice: 'desktop' | 'mobile';
}

function setDeviceCookie(device: 'desktop' | 'mobile'): void {
  if (typeof document === 'undefined') return;
  const maxAge = 60 * 60 * 24 * 365; // 1 year
  // `Secure` is ignored by browsers over plain HTTP, so it's safe to always
  // include — adds protection when the PWA is served over HTTPS.
  document.cookie = `helprr-device=${device}; Path=/; SameSite=Lax; Secure; Max-Age=${maxAge}`;
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
  // No `key` here — keying on initialLayout.id remounts the provider (and
  // every drawer / edit-mode flag below it) on every layout switch. The
  // provider now syncs its working set when activeLayoutId changes, so
  // staying mounted preserves the LayoutSwitcher drawer, edit mode, and
  // gallery state across the switch.
  return (
    <DashboardLayoutProvider
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
      // After a refresh triggered by the mismatch branch, the effect re-runs
      // here with matched devices — clear the spinner so the page becomes
      // interactive again.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the reload spinner once devices match
      setReloading(false);
      setDeviceCookie(detectedDevice);
      return;
    }
    setReloading(true);
    setDeviceCookie(detectedDevice);
    router.refresh();
  }, [detectedDevice, initialDevice, router]);

  const editMode = useUIStore((s) => s.dashboardEditMode);
  const setEditMode = useUIStore((s) => s.setDashboardEditMode);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [refreshDrawerOpen, setRefreshDrawerOpen] = useState(false);

  const { widgets, isDirty, setWidgets } = useDashboardLayout();

  useEffect(() => {
    return () => setEditMode(false);
  }, [setEditMode]);

  const saveMutation = useMutation({
    mutationFn: async (nextWidgets: WidgetInstance[]) => {
      const res = await fetch(`/api/dashboard-layouts/${initialLayout.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgets: nextWidgets }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'Failed to save');
      }
    },
    onSuccess: () => {
      toast.success('Saved');
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save');
    },
  });

  const saving = saveMutation.isPending;

  const handleSave = useCallback(async (): Promise<boolean> => {
    try {
      await saveMutation.mutateAsync(widgets);
      return true;
    } catch {
      return false;
    }
  }, [saveMutation, widgets]);

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
      return;
    }
    setEditMode(true);
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
        // The --hpr-* theme vars are inherited from <html>: set pre-paint by the
        // bootstrap script (root layout) and kept in sync by ThemeApplier. Not
        // pinned inline here, so the bento doesn't override them with stale
        // pre-hydration defaults — first paint already uses the persisted theme.
        margin: isMobile ? '-0.5rem -0.5rem -1rem' : '-1.5rem',
        padding: isMobile ? '0.5rem 0.75rem 5rem' : '1.25rem 1.75rem 3.5rem',
        minHeight: isMobile
          ? 'calc(100dvh - var(--header-height, 0px) - 4rem)'
          : '100%',
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
          onConfigureRefresh={() => setRefreshDrawerOpen(true)}
          onSave={handleSave}
          onDiscard={handleDiscard}
          onDone={handleDone}
          saving={saving}
          dirty={isDirty}
        />
      )}
      <WidgetGrid isMobile={isMobile} onConfigureRefresh={() => setRefreshDrawerOpen(true)} />

     {!editMode && <FloatingEdit edit={editMode} mobile={isMobile} onClick={handleFloatingToggle} />}
      <WidgetGallery open={galleryOpen} onOpenChange={setGalleryOpen} />
      <LayoutSwitcher
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        activeLayoutId={initialLayout.id}
        device={detectedDevice}
        onLayoutSwitched={handleLayoutSwitched}
      />
      <RefreshIntervalDrawer
        open={refreshDrawerOpen}
        onOpenChange={setRefreshDrawerOpen}
        layoutName={initialLayout.name}
      />
    </div>
  );
}
