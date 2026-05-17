'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { HPR } from './bento-primitives';
import type { WidgetInstance } from '@/lib/widgets/types';
import { useDashboardLayout } from './dashboard-layout-context';
import { useUIStore } from '@/lib/store';
import { buildDashboardThemeStyle } from '@/lib/dashboard-theme';

interface LayoutRecord {
  id: string;
  name: string;
  widgets: WidgetInstance[];
  createdAt: string;
  updatedAt: string;
}

interface LayoutsList {
  layouts: LayoutRecord[];
  defaultDesktopLayoutId: string | null;
  defaultMobileLayoutId: string | null;
}

interface LayoutSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeLayoutId: string;
  device: 'desktop' | 'mobile';
  onLayoutSwitched: () => void;
}

export function LayoutSwitcher({
  open,
  onOpenChange,
  activeLayoutId,
  device,
  onLayoutSwitched,
}: LayoutSwitcherProps) {
  const { widgets } = useDashboardLayout();
  // Mirror the dashboard's live theme so the drawer/dialog (rendered in a
  // portal outside the dashboard root) inherit the same --hpr-* variables.
  // Without this the drawer falls back to globals.css defaults (amber/yellow).
  const accent = useUIStore((s) => s.dashboardAccent);
  const palette = useUIStore((s) => s.dashboardPalette);
  const gradient = useUIStore((s) => s.dashboardGradient);
  const font = useUIStore((s) => s.dashboardFont);
  const themeStyle = useMemo(
    () => buildDashboardThemeStyle({ accent, palette, gradient, font }),
    [accent, palette, gradient, font],
  );
  const [data, setData] = useState<LayoutsList | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameOriginal, setRenameOriginal] = useState('');
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsValue, setSaveAsValue] = useState('');
  const [saveAsBusy, setSaveAsBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LayoutRecord | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard-layouts');
      if (!res.ok) throw new Error('Failed to load layouts');
      const json = (await res.json()) as LayoutsList;
      setData(json);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load layouts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  async function callApi(input: RequestInfo, init?: RequestInit, successMessage?: string): Promise<unknown> {
    const res = await fetch(input, init);
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // noop
    }
    if (!res.ok) {
      const message = typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : 'Request failed';
      throw new Error(message);
    }
    if (successMessage) toast.success(successMessage);
    return payload;
  }

  async function handleSetDefault(layoutId: string, target: 'desktop' | 'mobile') {
    setBusyId(layoutId);
    try {
      await callApi(
        '/api/dashboard-layouts/defaults',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device: target, layoutId }),
        },
        `Set as ${target} default`,
      );
      await refresh();
      if (target === device) onLayoutSwitched();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCopy(layoutId: string) {
    setBusyId(layoutId);
    try {
      await callApi(`/api/dashboard-layouts/${layoutId}/copy`, { method: 'POST' }, 'Copied');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed');
    } finally {
      setBusyId(null);
    }
  }

  function startRename(layout: LayoutRecord) {
    setRenamingId(layout.id);
    setRenameValue(layout.name);
    setRenameOriginal(layout.name);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue('');
    setRenameOriginal('');
  }

  async function commitRename(layoutId: string) {
    const next = renameValue.trim();
    // No-op if blank or unchanged — keeps drive-by clicks on the name from
    // firing a PUT.
    if (!next || next === renameOriginal) {
      cancelRename();
      return;
    }
    setBusyId(layoutId);
    try {
      await callApi(
        `/api/dashboard-layouts/${layoutId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: next }),
        },
        'Renamed',
      );
      await refresh();
      cancelRename();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await callApi(`/api/dashboard-layouts/${deleteTarget.id}`, { method: 'DELETE' }, 'Deleted');
      setDeleteTarget(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed');
    } finally {
      setDeleteBusy(false);
    }
  }

  function openSaveAs() {
    setSaveAsValue('');
    setSaveAsOpen(true);
  }

  async function handleSaveAsSubmit() {
    const name = saveAsValue.trim();
    if (!name) {
      toast.error('Name is required');
      return;
    }
    setSaveAsBusy(true);
    try {
      await callApi(
        '/api/dashboard-layouts',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, widgets }),
        },
        'Layout created',
      );
      await refresh();
      setSaveAsOpen(false);
      setSaveAsValue('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed');
    } finally {
      setSaveAsBusy(false);
    }
  }

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent style={themeStyle}>
          <DrawerHeader>
            <DrawerTitle>Layouts</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-8 space-y-3">
            <button
              type="button"
              onClick={openSaveAs}
              className="w-full rounded-xl border border-dashed p-3 text-sm font-medium hover:bg-muted/30"
              style={{ borderColor: HPR.hairline2, color: HPR.amber }}
            >
              + Save current as new layout
            </button>

            {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
            {!loading && data?.layouts.map((layout) => {
              const isActive = layout.id === activeLayoutId;
              const isDesktopDefault = data.defaultDesktopLayoutId === layout.id;
              const isMobileDefault = data.defaultMobileLayoutId === layout.id;
              const isCurrentDefault = (device === 'desktop' && isDesktopDefault) || (device === 'mobile' && isMobileDefault);
              const canDelete = !isDesktopDefault && !isMobileDefault;
              const isRenaming = renamingId === layout.id;

              return (
                <div
                  key={layout.id}
                  className="rounded-xl border p-3 space-y-2"
                  style={{
                    borderColor: isActive ? HPR.amber : HPR.hairline,
                    background: isActive ? `color-mix(in oklab, ${HPR.amber} 8%, transparent)` : 'transparent',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    {isRenaming ? (
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => void commitRename(layout.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(layout.id);
                          if (e.key === 'Escape') cancelRename();
                        }}
                        className="h-8 flex-1 text-sm"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startRename(layout)}
                        className="flex-1 text-left text-sm font-medium truncate hover:opacity-70"
                      >
                        {layout.name}
                      </button>
                    )}
                    <div className="flex items-center gap-1 text-[9px] uppercase">
                      {isDesktopDefault && (
                        <span className="px-1.5 py-0.5 rounded bg-muted">PC default</span>
                      )}
                      {isMobileDefault && (
                        <span className="px-1.5 py-0.5 rounded bg-muted">Mobile default</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => void handleSetDefault(layout.id, 'desktop')}
                      disabled={busyId === layout.id || isDesktopDefault}
                      className="px-2 py-1 rounded border hover:bg-muted/30 disabled:opacity-40"
                      style={{ borderColor: HPR.hairline }}
                    >
                      Set as PC default
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSetDefault(layout.id, 'mobile')}
                      disabled={busyId === layout.id || isMobileDefault}
                      className="px-2 py-1 rounded border hover:bg-muted/30 disabled:opacity-40"
                      style={{ borderColor: HPR.hairline }}
                    >
                      Set as Mobile default
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopy(layout.id)}
                      disabled={busyId === layout.id}
                      className="px-2 py-1 rounded border hover:bg-muted/30 disabled:opacity-40"
                      style={{ borderColor: HPR.hairline }}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(layout)}
                      disabled={busyId === layout.id || !canDelete}
                      title={!canDelete ? 'Default layouts cannot be deleted' : undefined}
                      className="px-2 py-1 rounded border hover:bg-muted/30 disabled:opacity-40"
                      style={{ borderColor: HPR.hairline }}
                    >
                      Delete
                    </button>
                  </div>
                  {isCurrentDefault && (
                    <p className="text-[10px] text-muted-foreground">
                      Currently active on this device
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog open={saveAsOpen} onOpenChange={(next) => { if (!saveAsBusy) setSaveAsOpen(next); }}>
        <DialogContent className="sm:max-w-md" style={themeStyle}>
          <DialogHeader>
            <DialogTitle>Save as new layout</DialogTitle>
            <DialogDescription>
              The current widget arrangement will be saved as a new layout.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              autoFocus
              value={saveAsValue}
              onChange={(e) => setSaveAsValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveAsValue.trim() && !saveAsBusy) {
                  void handleSaveAsSubmit();
                }
              }}
              placeholder="Layout name"
              maxLength={50}
              disabled={saveAsBusy}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveAsOpen(false)} disabled={saveAsBusy}>
              Cancel
            </Button>
            <Button onClick={() => void handleSaveAsSubmit()} disabled={saveAsBusy || !saveAsValue.trim()}>
              {saveAsBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => { if (!next) setDeleteTarget(null); }}
        title="Delete layout?"
        description={deleteTarget ? `“${deleteTarget.name}” will be removed.` : undefined}
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
}
