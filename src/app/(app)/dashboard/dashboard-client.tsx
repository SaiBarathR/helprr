'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useUIStore } from '@/lib/store';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { WidgetGrid } from '@/components/widgets/widget-grid';
import dynamic from 'next/dynamic';
const WidgetGallery = dynamic(() => import('@/components/widgets/widget-gallery').then((module) => module.WidgetGallery));
const RefreshIntervalDrawer = dynamic(() => import('@/components/widgets/refresh-interval-drawer').then((module) => module.RefreshIntervalDrawer));
import { BentoTopBar, EditRow, HPR } from '@/components/widgets/bento-primitives';
import {
  DashboardLayoutProvider,
  useDashboardLayout,
} from '@/components/widgets/dashboard-layout-context';
import { WidgetAvailabilityProvider } from '@/lib/widgets/widget-availability-context';
import { LayoutSwitcher } from '@/components/widgets/layout-switcher';
import type { WidgetInstance, WidgetService } from '@/lib/widgets/types';
import { SetupChecklist } from '@/components/dashboard/setup-checklist';
import { LeavingSoonShelf } from '@/components/leaving-soon/leaving-soon-shelf';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
// Without Secure on plain http: a rejected cookie made the server render the other
// layout on every refresh, and this page refreshed forever.
import { writeDeviceCookie as setDeviceCookie } from '@/lib/client-sign-in';
import type { SetupChecklistState } from '@/lib/setup-checklist-steps';
import { PageTitle } from '@/components/layout/page-title';
import { useCan } from '@/components/permission-provider';

export interface InitialDashboardLayout {
  id: string;
  name: string;
  widgets: WidgetInstance[];
  isBuiltIn: boolean;
}

interface DashboardClientProps {
  initialLayout: InitialDashboardLayout;
  initialDevice: 'desktop' | 'mobile';
  configuredServices: WidgetService[];
  /** The admin's setup checklist; null for members. */
  setupChecklist?: SetupChecklistState | null;
}


const REFRESHED_FOR_KEY = 'helprr-dashboard-refreshed-for';

function readRefreshedFor(): string | null {
  try {
    return sessionStorage.getItem(REFRESHED_FOR_KEY);
  } catch {
    return null;
  }
}

function writeRefreshedFor(device: 'desktop' | 'mobile' | null): void {
  try {
    if (device) sessionStorage.setItem(REFRESHED_FOR_KEY, device);
    else sessionStorage.removeItem(REFRESHED_FOR_KEY);
  } catch {
    // Storage blocked: the in-memory ref still guards this page load.
  }
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

export function DashboardClient({
  initialLayout,
  initialDevice,
  configuredServices,
  setupChecklist = null,
}: DashboardClientProps) {
  // No `key` here — keying on initialLayout.id remounts the provider (and
  // every drawer / edit-mode flag below it) on every layout switch. The
  // provider now syncs its working set when activeLayoutId changes, so
  // staying mounted preserves the LayoutSwitcher drawer, edit mode, and
  // gallery state across the switch.
  return (
    <WidgetAvailabilityProvider services={configuredServices}>
      <DashboardLayoutProvider
        initialWidgets={initialLayout.widgets}
        activeLayoutId={initialLayout.id}
      >
        <DashboardInner
          initialLayout={initialLayout}
          initialDevice={initialDevice}
          configuredServices={configuredServices}
          setupChecklist={setupChecklist}
        />
      </DashboardLayoutProvider>
    </WidgetAvailabilityProvider>
  );
}

function DashboardInner({ initialLayout, initialDevice, setupChecklist }: DashboardClientProps) {
  const router = useRouter();
  const isMobile = useIsMobile(768);
  const detectedDevice: 'desktop' | 'mobile' = isMobile ? 'mobile' : 'desktop';
  const [reloading, setReloading] = useState(false);
  // The device a refresh was already asked for. If the server still renders the other
  // layout after it (the cookie was refused: cookies blocked, a policy), show that
  // layout rather than refresh forever.
  const refreshedFor = useRef<'desktop' | 'mobile' | null>(null);

  // Sync the cookie + reload when the device disagrees with what the server
  // rendered. The hydration pass reports desktop (useIsMobile's server
  // snapshot), so read the media query itself; detectedDevice only re-runs
  // this when the breakpoint is crossed.
  useEffect(() => {
    const device = window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop';
    setDeviceCookie(device);
    const askedFor = refreshedFor.current;
    if (device === initialDevice) writeRefreshedFor(null);
    // Offline, a failed refresh falls back to a full page load, which would
    // land here again; the stored device also stops a repeat across page loads.
    if (
      device === initialDevice
      || (askedFor !== device && (readRefreshedFor() === device || !navigator.onLine))
    ) {
      // After a refresh triggered by the mismatch branch, the effect re-runs
      // here with matched devices — clear the spinner so the page becomes
      // interactive again.
      setReloading(false);
      return;
    }
    // This page already asked for this device: keep the spinner until it lands.
    if (askedFor === device) return;
    refreshedFor.current = device;
    writeRefreshedFor(device);
    setReloading(true);
    router.refresh();
  }, [detectedDevice, initialDevice, router]);

  const editMode = useUIStore((s) => s.dashboardEditMode);
  // UX only: the layout routes check dashboard.customize themselves.
  const canCustomize = useCan('dashboard.customize');
  const setEditMode = useUIStore((s) => s.setDashboardEditMode);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [refreshDrawerOpen, setRefreshDrawerOpen] = useState(false);

  const { widgets, isDirty, setWidgets } = useDashboardLayout();
  const queryClient = useQueryClient();

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
        // Cancels <main>'s padding from its variables: a landscape phone uses a
        // smaller top padding than the md 1.5rem.
        margin: isMobile ? '-0.5rem -0.5rem -1rem' : 'calc(-1 * var(--main-pad-top)) calc(-1 * var(--main-pad-x)) -1.5rem',
        // The bottom padding lets the last row scroll clear of the mini video
        // player while it is up, instead of resting under it. While the offline
        // pill shows, <main>'s own padding already holds that room (with the
        // pill's), so none is added here twice.
        padding: isMobile
          ? '0.5rem 0.75rem calc(1rem + max(0px, var(--mini-player-clearance, 0px) - var(--browse-notice-clearance, 0px)))'
          : '1.25rem 1.75rem calc(1.5rem + max(0px, var(--mini-player-clearance, 0px) - var(--browse-notice-clearance, 0px)))',
        minHeight: isMobile
          ? 'calc(100dvh - var(--header-height, 0px) - var(--footer-height, 0px))'
          : '100%',
      }}
    >
      <PageTitle>Dashboard</PageTitle>
      {/* Every widget fetches through useWidgetData's ['widget-data', …] keys; only
          the mounted ones refetch. Off while editing, where touches drag widgets. */}
      <PullToRefresh
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ['widget-data'] })}
        disabled={editMode}
      />
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
      {!editMode && canCustomize && <EditRow mobile={isMobile} onClick={() => setEditMode(true)} />}
      {!editMode && setupChecklist && <SetupChecklist initial={setupChecklist} mobile={isMobile} />}
      {!editMode && <LeavingSoonShelf />}
      <WidgetGrid isMobile={isMobile} onConfigureRefresh={() => setRefreshDrawerOpen(true)} />

      {galleryOpen && <WidgetGallery open={galleryOpen} onOpenChange={setGalleryOpen} />}
      <LayoutSwitcher
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        activeLayoutId={initialLayout.id}
        device={detectedDevice}
        onLayoutSwitched={handleLayoutSwitched}
      />
      {refreshDrawerOpen && <RefreshIntervalDrawer
        open={refreshDrawerOpen}
        onOpenChange={setRefreshDrawerOpen}
        layoutName={initialLayout.name}
      />}
    </div>
  );
}
