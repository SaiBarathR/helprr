'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  isBuiltIn?: boolean;
  slug?: 'desktop' | 'mobile' | null;
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
  const { widgets, setWidgets } = useDashboardLayout();
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
  const queryClient = useQueryClient();
  const layoutsQuery = useQuery({
    queryKey: ['dashboard-layouts'],
    queryFn: async ({ signal }): Promise<LayoutsList> => {
      const res = await fetch('/api/dashboard-layouts', { signal });
      if (!res.ok) throw new Error('Failed to load layouts');
      return (await res.json()) as LayoutsList;
    },
    enabled: open,
  });
  const data = layoutsQuery.data ?? null;
  const loading = layoutsQuery.isFetching;
  useEffect(() => {
    if (layoutsQuery.isError) toast.error('Failed to load layouts');
  }, [layoutsQuery.isError]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    'desktop' | 'mobile' | 'copy' | 'rename' | null
  >(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameOriginal, setRenameOriginal] = useState('');
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsValue, setSaveAsValue] = useState('');
  const [saveAsBusy, setSaveAsBusy] = useState(false);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [emptyValue, setEmptyValue] = useState('');
  const [emptyBusy, setEmptyBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LayoutRecord | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState<LayoutRecord | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

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
    setBusyAction(target);
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
      await queryClient.invalidateQueries({ queryKey: ['dashboard-layouts'] });
      // Auto-switch the dashboard when the user makes a different layout the
      // default for the device they're currently on. The provider no longer
      // re-keys on layout id, so router.refresh() can re-render the page
      // contents (server-fetched widgets for the new default) without
      // closing this drawer or dropping edit mode.
      if (target === device && layoutId !== activeLayoutId) {
        onLayoutSwitched();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed');
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  async function handleCopy(layoutId: string) {
    setBusyId(layoutId);
    setBusyAction('copy');
    try {
      await callApi(`/api/dashboard-layouts/${layoutId}/copy`, { method: 'POST' }, 'Copied');
      await queryClient.invalidateQueries({ queryKey: ['dashboard-layouts'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed');
    } finally {
      setBusyId(null);
      setBusyAction(null);
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
    // Clear the rename state immediately so the input's blur handler (which
    // fires synchronously when Enter moves focus away) sees no active rename
    // and bails out — otherwise Enter would queue a second PUT via onBlur.
    setRenamingId(null);
    setRenameValue('');
    setRenameOriginal('');
    setBusyId(layoutId);
    setBusyAction('rename');
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
      await queryClient.invalidateQueries({ queryKey: ['dashboard-layouts'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed');
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  async function handleResetConfirm() {
    if (!resetTarget) return;
    const target = resetTarget;
    setResetBusy(true);
    try {
      const response = await callApi(
        `/api/dashboard-layouts/${target.id}/reset`,
        { method: 'POST' },
        'Reset to default',
      );
      setResetTarget(null);
      // The provider only resyncs its working set when activeLayoutId changes
      // (see DashboardLayoutProvider). A reset keeps the same id and only
      // swaps the widgets array, so without pushing the new widgets in here
      // the dashboard would keep showing the pre-reset arrangement.
      if (target.id === activeLayoutId) {
        const next = response && typeof response === 'object' && 'widgets' in response
          ? (response as { widgets: unknown }).widgets
          : null;
        if (Array.isArray(next)) {
          setWidgets(next as WidgetInstance[]);
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['dashboard-layouts'] });
      if (target.id === activeLayoutId) {
        onLayoutSwitched();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed');
    } finally {
      setResetBusy(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await callApi(`/api/dashboard-layouts/${deleteTarget.id}`, { method: 'DELETE' }, 'Deleted');
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['dashboard-layouts'] });
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
      await queryClient.invalidateQueries({ queryKey: ['dashboard-layouts'] });
      setSaveAsOpen(false);
      setSaveAsValue('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed');
    } finally {
      setSaveAsBusy(false);
    }
  }

  function openCreateEmpty() {
    setEmptyValue('');
    setEmptyOpen(true);
  }

  async function handleCreateEmptySubmit() {
    const name = emptyValue.trim();
    if (!name) {
      toast.error('Name is required');
      return;
    }
    setEmptyBusy(true);
    try {
      await callApi(
        '/api/dashboard-layouts',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, widgets: [] }),
        },
        'Layout created',
      );
      await queryClient.invalidateQueries({ queryKey: ['dashboard-layouts'] });
      setEmptyOpen(false);
      setEmptyValue('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed');
    } finally {
      setEmptyBusy(false);
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
            <div className="flex gap-2">
              <button
                type="button"
                onClick={openSaveAs}
                className="flex-1 rounded-xl border border-dashed p-3 text-sm font-medium hover:bg-muted/30"
                style={{ borderColor: HPR.hairline2, color: HPR.amber }}
              >
                + Save current as new
              </button>
              <button
                type="button"
                onClick={openCreateEmpty}
                className="flex-1 rounded-xl border border-dashed p-3 text-sm font-medium hover:bg-muted/30"
                style={{ borderColor: HPR.hairline2, color: HPR.amber }}
              >
                + Create empty layout
              </button>
            </div>

            {loading && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && data?.layouts.map((layout) => {
              const isActive = layout.id === activeLayoutId;
              const isDesktopDefault = data.defaultDesktopLayoutId === layout.id;
              const isMobileDefault = data.defaultMobileLayoutId === layout.id;
              const isCurrentDefault = (device === 'desktop' && isDesktopDefault) || (device === 'mobile' && isMobileDefault);
              const isBuiltIn = Boolean(layout.isBuiltIn);
              const canDelete = !isBuiltIn && !isDesktopDefault && !isMobileDefault;
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
                        className="flex-1 text-left text-sm font-medium truncate hover:opacity-70 flex items-center gap-2"
                      >
                        {busyId === layout.id && busyAction === 'rename' && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        <span className="truncate">{layout.name}</span>
                      </button>
                    )}
                    <div className="flex items-center gap-1 text-[9px] uppercase">
                      {isBuiltIn && (
                        <span className="px-1.5 py-0.5 rounded bg-muted">Built-in</span>
                      )}
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
                      className="px-2 py-1 rounded border hover:bg-muted/30 disabled:opacity-40 inline-flex items-center"
                      style={{ borderColor: HPR.hairline }}
                    >
                      {busyId === layout.id && busyAction === 'desktop' && (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      )}
                      Set as PC default
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSetDefault(layout.id, 'mobile')}
                      disabled={busyId === layout.id || isMobileDefault}
                      className="px-2 py-1 rounded border hover:bg-muted/30 disabled:opacity-40 inline-flex items-center"
                      style={{ borderColor: HPR.hairline }}
                    >
                      {busyId === layout.id && busyAction === 'mobile' && (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      )}
                      Set as Mobile default
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopy(layout.id)}
                      disabled={busyId === layout.id}
                      className="px-2 py-1 rounded border hover:bg-muted/30 disabled:opacity-40 inline-flex items-center"
                      style={{ borderColor: HPR.hairline }}
                    >
                      {busyId === layout.id && busyAction === 'copy' && (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      )}
                      Copy
                    </button>
                    {isBuiltIn && (
                      <button
                        type="button"
                        onClick={() => setResetTarget(layout)}
                        disabled={busyId === layout.id || resetBusy}
                        title="Restore this layout to its original default widgets"
                        className="px-2 py-1 rounded border hover:bg-muted/30 disabled:opacity-40"
                        style={{ borderColor: HPR.hairline }}
                      >
                        Reset
                      </button>
                    )}
                    {!isBuiltIn && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(layout)}
                        disabled={busyId === layout.id || !canDelete}
                        title={!canDelete ? 'A layout set as a device default cannot be deleted' : undefined}
                        className="px-2 py-1 rounded border hover:bg-muted/30 disabled:opacity-40"
                        style={{ borderColor: HPR.hairline }}
                      >
                        Delete
                      </button>
                    )}
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

      <ConfirmDialog
        open={resetTarget !== null}
        onOpenChange={(next) => { if (!next && !resetBusy) setResetTarget(null); }}
        title="Reset to default?"
        description={
          resetTarget
            ? `“${resetTarget.name}” will be restored to its original widgets. Any changes you've made to this layout will be discarded.`
            : undefined
        }
        confirmLabel="Reset"
        destructive
        busy={resetBusy}
        onConfirm={handleResetConfirm}
      />

      <Dialog open={emptyOpen} onOpenChange={(next) => { if (!emptyBusy) setEmptyOpen(next); }}>
        <DialogContent className="sm:max-w-md" style={themeStyle}>
          <DialogHeader>
            <DialogTitle>Create empty layout</DialogTitle>
            <DialogDescription>
              A new layout will be created with no widgets. You can add widgets from the
              edit toolbar.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              autoFocus
              value={emptyValue}
              onChange={(e) => setEmptyValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && emptyValue.trim() && !emptyBusy) {
                  void handleCreateEmptySubmit();
                }
              }}
              placeholder="Layout name"
              maxLength={50}
              disabled={emptyBusy}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmptyOpen(false)} disabled={emptyBusy}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreateEmptySubmit()} disabled={emptyBusy || !emptyValue.trim()}>
              {emptyBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
