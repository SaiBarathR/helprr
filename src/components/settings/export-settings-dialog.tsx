'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useMe } from '@/components/permission-provider';
import { useUIStore, STORE_VERSION } from '@/lib/store';
import {
  UI_PREF_CATEGORY_IDS,
  UI_PREF_CATEGORY_LABELS,
  UI_PREF_CATEGORY_FIELDS,
  SERVICE_TYPE_LABELS,
  type UiPrefCategoryId,
  type SettingsExportPayload,
  EXPORT_FORMAT_KIND,
  EXPORT_FORMAT_VERSION,
  extractUiPrefsByCategory,
} from '@/lib/settings-export';
import type { ServiceType } from '@prisma/client';

interface ExportSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ConnectedServiceInfo {
  type: ServiceType;
}

export function ExportSettingsDialog({ open, onOpenChange }: ExportSettingsDialogProps) {
  // Global sections (app settings, services, users, …) are admin-only; the
  // server enforces this too — members with settings.backup export only their
  // own watchlist, scheduled alerts, and device-local UI prefs.
  const isAdmin = useMe()?.role === 'admin';
  const [selectedUi, setSelectedUi] = useState<Set<UiPrefCategoryId>>(
    () => new Set(UI_PREF_CATEGORY_IDS)
  );
  const [selectedAppSettings, setSelectedAppSettings] = useState(isAdmin);
  const [selectedDiscoverLayout, setSelectedDiscoverLayout] = useState(isAdmin);
  const [selectedNotifPrefs, setSelectedNotifPrefs] = useState(isAdmin);
  const [selectedCleanup, setSelectedCleanup] = useState(isAdmin);
  const [selectedDashboardLayouts, setSelectedDashboardLayouts] = useState(isAdmin);
  const [selectedWatchlist, setSelectedWatchlist] = useState(false);
  const [selectedScheduledAlerts, setSelectedScheduledAlerts] = useState(false);
  const [selectedAnimeMappings, setSelectedAnimeMappings] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState(false);
  const [availableServices, setAvailableServices] = useState<ConnectedServiceInfo[]>([]);
  const [selectedServices, setSelectedServices] = useState<Set<ServiceType>>(new Set());
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);

  useEffect(() => {
    if (!open || !isAdmin) return;
    setLoadingServices(true);
    fetch('/api/services')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        const arr = Array.isArray(data) ? data : [];
        // /api/services returns one row per connection, so multi-instance setups
        // repeat a type (e.g. two Sonarr). Export is per-type, so dedupe by type.
        const types = new Set<ServiceType>(
          arr
            .filter((c): c is { type: ServiceType } => !!c && typeof c === 'object' && typeof (c as { type?: unknown }).type === 'string')
            .map((c) => c.type)
        );
        const list: ConnectedServiceInfo[] = [...types].map((type) => ({ type }));
        setAvailableServices(list);
        setSelectedServices(new Set(list.map((s) => s.type)));
      })
      .catch(() => {
        setAvailableServices([]);
        setSelectedServices(new Set());
      })
      .finally(() => setLoadingServices(false));
  }, [open, isAdmin]);

  const allUiSelected = selectedUi.size === UI_PREF_CATEGORY_IDS.length;
  const noneUiSelected = selectedUi.size === 0;
  const allServicesSelected =
    availableServices.length > 0 && selectedServices.size === availableServices.length;
  const noneServicesSelected = selectedServices.size === 0;

  function toggleUi(id: UiPrefCategoryId) {
    setSelectedUi((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllUi() {
    setSelectedUi(allUiSelected ? new Set() : new Set(UI_PREF_CATEGORY_IDS));
  }

  function toggleService(type: ServiceType) {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function toggleAllServices() {
    setSelectedServices(
      allServicesSelected ? new Set() : new Set(availableServices.map((s) => s.type))
    );
  }

  const nothingSelected = useMemo(() => (
    selectedUi.size === 0
    && !selectedAppSettings
    && !selectedDiscoverLayout
    && !selectedNotifPrefs
    && !selectedCleanup
    && !selectedDashboardLayouts
    && !selectedWatchlist
    && !selectedScheduledAlerts
    && !selectedAnimeMappings
    && !selectedUsers
    && selectedServices.size === 0
  ), [selectedUi, selectedAppSettings, selectedDiscoverLayout, selectedNotifPrefs, selectedCleanup, selectedDashboardLayouts, selectedWatchlist, selectedScheduledAlerts, selectedAnimeMappings, selectedUsers, selectedServices]);

  async function handleExport() {
    if (nothingSelected) {
      toast.error('Select at least one category to export.');
      return;
    }
    setExporting(true);
    try {
      const serverRes = await fetch('/api/settings/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appSettings: selectedAppSettings,
          discoverLayout: selectedDiscoverLayout,
          services: selectedServices.size > 0 ? Array.from(selectedServices) : false,
          notificationPrefs: selectedNotifPrefs,
          cleanup: selectedCleanup,
          dashboardLayouts: selectedDashboardLayouts,
          watchlist: selectedWatchlist,
          scheduledAlerts: selectedScheduledAlerts,
          animeMappings: selectedAnimeMappings,
          users: selectedUsers,
          includeSecrets,
        }),
      });
      if (!serverRes.ok) {
        const err = await serverRes.json().catch(() => null);
        throw new Error(err?.error || 'Failed to fetch export data');
      }
      const serverPayload = (await serverRes.json()) as Omit<SettingsExportPayload, 'uiPrefs'>;

      const state = useUIStore.getState() as unknown as Record<string, unknown>;
      const uiPrefs: Partial<Record<UiPrefCategoryId, Record<string, unknown>>> = {};
      for (const id of selectedUi) {
        uiPrefs[id] = extractUiPrefsByCategory(state, id);
      }

      const fullPayload: SettingsExportPayload = {
        kind: EXPORT_FORMAT_KIND,
        version: EXPORT_FORMAT_VERSION,
        exportedAt: serverPayload.exportedAt ?? new Date().toISOString(),
        zustandVersion: STORE_VERSION,
        includesSecrets: includeSecrets,
        ...(Object.keys(uiPrefs).length > 0 && { uiPrefs }),
        ...(serverPayload.appSettings && { appSettings: serverPayload.appSettings }),
        ...(serverPayload.serviceConnections && { serviceConnections: serverPayload.serviceConnections }),
        ...(serverPayload.notificationPrefs && { notificationPrefs: serverPayload.notificationPrefs }),
        ...(serverPayload.cleanup && { cleanup: serverPayload.cleanup }),
        ...(serverPayload.discoverLayout && { discoverLayout: serverPayload.discoverLayout }),
        ...(serverPayload.dashboardLayouts && { dashboardLayouts: serverPayload.dashboardLayouts }),
        ...(serverPayload.watchlist && { watchlist: serverPayload.watchlist }),
        ...(serverPayload.scheduledAlerts && { scheduledAlerts: serverPayload.scheduledAlerts }),
        ...(serverPayload.animeMappings && { animeMappings: serverPayload.animeMappings }),
        ...(serverPayload.users && { users: serverPayload.users }),
      };

      const json = JSON.stringify(fullPayload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const today = new Date().toISOString().slice(0, 10);
      link.download = `helprr-settings-${today}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('Settings exported.');
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error)?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Settings</DialogTitle>
          <DialogDescription>
            Pick what to include. Per-field categories let you migrate just the parts you want.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* UI Preferences */}
          <section>
            <div className="flex w-full items-center gap-3">
              <Checkbox
                checked={allUiSelected ? true : noneUiSelected ? false : 'indeterminate'}
                onCheckedChange={toggleAllUi}
              />
              <span
                className="text-sm font-medium cursor-pointer select-none"
                onClick={toggleAllUi}
              >
                UI Preferences
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {selectedUi.size}/{UI_PREF_CATEGORY_IDS.length}
              </span>
            </div>
            <div className="mt-2 ml-6 space-y-2">
              {UI_PREF_CATEGORY_IDS.map((id) => (
                <label key={id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={selectedUi.has(id)}
                    onCheckedChange={() => toggleUi(id)}
                  />
                  <span className="text-sm">{UI_PREF_CATEGORY_LABELS[id]}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {UI_PREF_CATEGORY_FIELDS[id].length} field{UI_PREF_CATEGORY_FIELDS[id].length === 1 ? '' : 's'}
                  </span>
                </label>
              ))}
            </div>
          </section>

          {isAdmin && (<>
          {/* App Settings */}
          <section>
            <label className="flex w-full items-center gap-3 cursor-pointer">
              <Checkbox
                checked={selectedAppSettings}
                onCheckedChange={(v) => setSelectedAppSettings(v === true)}
              />
              <div>
                <div className="text-sm font-medium">App Settings</div>
                <div className="text-xs text-muted-foreground">
                  Polling intervals, timezone, logging, image cache, upcoming-release notification timing,
                  watch-provider region, activity digest, anime auto-map, AniList cache TTLs, and the
                  qBittorrent bandwidth schedule. Discover homepage layout is a separate option below.
                </div>
              </div>
            </label>
          </section>

          {/* Discover Layout */}
          <section>
            <label className="flex w-full items-center gap-3 cursor-pointer">
              <Checkbox
                checked={selectedDiscoverLayout}
                onCheckedChange={(v) => setSelectedDiscoverLayout(v === true)}
              />
              <div>
                <div className="text-sm font-medium">Discover Layout</div>
                <div className="text-xs text-muted-foreground">
                  Section order, hidden builtin sections, and custom carousels (with their saved filters).
                </div>
              </div>
            </label>
          </section>

          {/* Service Connections */}
          <section>
            <div className="flex w-full items-center gap-3">
              <Checkbox
                checked={
                  allServicesSelected ? true : noneServicesSelected ? false : 'indeterminate'
                }
                onCheckedChange={toggleAllServices}
                disabled={availableServices.length === 0}
              />
              <span
                className={`text-sm font-medium select-none ${availableServices.length === 0 ? 'opacity-50' : 'cursor-pointer'}`}
                onClick={availableServices.length === 0 ? undefined : toggleAllServices}
              >
                Service Connections
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {loadingServices
                  ? 'loading…'
                  : availableServices.length === 0
                    ? 'none configured'
                    : `${selectedServices.size}/${availableServices.length}`}
              </span>
            </div>
            {availableServices.length > 0 && (
              <div className="mt-2 ml-6 space-y-2">
                {availableServices.map(({ type }) => (
                  <label key={type} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={selectedServices.has(type)}
                      onCheckedChange={() => toggleService(type)}
                    />
                    <span className="text-sm">{SERVICE_TYPE_LABELS[type]}</span>
                  </label>
                ))}
              </div>
            )}
          </section>

          {/* Notification Preferences */}
          <section>
            <label className="flex w-full items-center gap-3 cursor-pointer">
              <Checkbox
                checked={selectedNotifPrefs}
                onCheckedChange={(v) => setSelectedNotifPrefs(v === true)}
              />
              <div>
                <div className="text-sm font-medium">Notification Preferences</div>
                <div className="text-xs text-muted-foreground">
                  Rules for all registered devices (chosen at import time)
                </div>
              </div>
            </label>
          </section>

          {/* Cleanup */}
          <section>
            <label className="flex w-full items-center gap-3 cursor-pointer">
              <Checkbox
                checked={selectedCleanup}
                onCheckedChange={(v) => setSelectedCleanup(v === true)}
              />
              <div>
                <div className="text-sm font-medium">Cleanup</div>
                <div className="text-xs text-muted-foreground">
                  Queue &amp; download cleaner configs plus all stall, slow, and seeding rules
                </div>
              </div>
            </label>
          </section>

          {/* Dashboard Layouts */}
          <section>
            <label className="flex w-full items-center gap-3 cursor-pointer">
              <Checkbox
                checked={selectedDashboardLayouts}
                onCheckedChange={(v) => setSelectedDashboardLayouts(v === true)}
              />
              <div>
                <div className="text-sm font-medium">Dashboard Layouts</div>
                <div className="text-xs text-muted-foreground">
                  Global bento layouts (built-in + admin-created), widget positions, per-widget refresh intervals, and the active default for desktop &amp; mobile. Members&apos; personal layouts are included with User Accounts.
                </div>
              </div>
            </label>
          </section>
          </>)}

          {/* Watchlist */}
          <section>
            <label className="flex w-full items-center gap-3 cursor-pointer">
              <Checkbox
                checked={selectedWatchlist}
                onCheckedChange={(v) => setSelectedWatchlist(v === true)}
              />
              <div>
                <div className="text-sm font-medium">Watchlist</div>
                <div className="text-xs text-muted-foreground">
                  Watchlist items (with tags &amp; reminders). Off by default — content, not settings.
                </div>
              </div>
            </label>
          </section>

          {/* Scheduled Alerts */}
          <section>
            <label className="flex w-full items-center gap-3 cursor-pointer">
              <Checkbox
                checked={selectedScheduledAlerts}
                onCheckedChange={(v) => setSelectedScheduledAlerts(v === true)}
              />
              <div>
                <div className="text-sm font-medium">Scheduled alerts</div>
                <div className="text-xs text-muted-foreground">
                  Your active release reminders. Off by default — content, not settings.
                </div>
              </div>
            </label>
          </section>

          {isAdmin && (<>
          {/* Anime Mappings */}
          <section>
            <label className="flex w-full items-center gap-3 cursor-pointer">
              <Checkbox
                checked={selectedAnimeMappings}
                onCheckedChange={(v) => setSelectedAnimeMappings(v === true)}
              />
              <div>
                <div className="text-sm font-medium">Anime mappings</div>
                <div className="text-xs text-muted-foreground">
                  Sonarr series ↔ AniList links (manual &amp; auto), with their cached titles. Off by default — content, not settings.
                </div>
              </div>
            </label>
          </section>

          {/* Users & accounts */}
          <section>
            <label className="flex w-full items-center gap-3 cursor-pointer">
              <Checkbox
                checked={selectedUsers}
                onCheckedChange={(v) => setSelectedUsers(v === true)}
              />
              <div>
                <div className="text-sm font-medium">Users &amp; accounts</div>
                <div className="text-xs text-muted-foreground">
                  Accounts, roles, permissions, and per-user settings — plus each user&apos;s watchlist,
                  scheduled alerts, and personal dashboard layouts. Passwords are only included when
                  &ldquo;Include API keys / tokens&rdquo; is on; AniList/Jellyfin tokens are never exported.
                  Off by default.
                </div>
              </div>
            </label>
          </section>

          {/* Secrets toggle */}
          <section className="border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <Label htmlFor="export-secrets" className="text-sm font-medium">
                  Include API keys / tokens
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Off by default. When on, the file contains plain-text credentials.
                </p>
              </div>
              <Switch
                id="export-secrets"
                checked={includeSecrets}
                onCheckedChange={setIncludeSecrets}
              />
            </div>
            {includeSecrets && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                <p className="text-xs text-amber-200">
                  This export will contain unencrypted API keys and OAuth tokens. Treat the file like a password.
                </p>
              </div>
            )}
          </section>
          </>)}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={exporting || nothingSelected}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {exporting ? 'Exporting…' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
