'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, FileJson, Loader2, Upload } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUIStore, migrateUiPrefs, STORE_VERSION } from '@/lib/store';
import {
  UI_PREF_CATEGORY_IDS,
  UI_PREF_CATEGORY_LABELS,
  UI_PREF_CATEGORY_FIELDS,
  SERVICE_TYPE_LABELS,
  type UiPrefCategoryId,
  type SettingsExportPayload,
  validateImportFile,
} from '@/lib/settings-export';
import type { ServiceType } from '@prisma/client';

const MAX_IMPORT_BYTES = 1_048_576;

interface ImportSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

interface ParsedFile {
  payload: SettingsExportPayload;
  warnings: string[];
  uiPrefsMigrated: Partial<Record<UiPrefCategoryId, Record<string, unknown>>>;
  availableUi: UiPrefCategoryId[];
  availableServices: ServiceType[];
}

function buildMigratedUiPrefs(
  payload: SettingsExportPayload
): Partial<Record<UiPrefCategoryId, Record<string, unknown>>> {
  if (!payload.uiPrefs) return {};
  if (payload.zustandVersion === STORE_VERSION) {
    return payload.uiPrefs;
  }
  // Run the migration chain on the flattened uiPrefs.
  const flat: Record<string, unknown> = {};
  for (const id of UI_PREF_CATEGORY_IDS) {
    const cat = payload.uiPrefs[id];
    if (cat) Object.assign(flat, cat);
  }
  const migrated = migrateUiPrefs(flat, payload.zustandVersion);
  // Re-bucket back into categories using the current category map.
  const result: Partial<Record<UiPrefCategoryId, Record<string, unknown>>> = {};
  for (const id of UI_PREF_CATEGORY_IDS) {
    const fields = UI_PREF_CATEGORY_FIELDS[id];
    const bucket: Record<string, unknown> = {};
    let hasAny = false;
    for (const f of fields) {
      if (f in migrated) {
        bucket[f] = migrated[f];
        hasAny = true;
      }
    }
    if (hasAny) result[id] = bucket;
  }
  return result;
}

export function ImportSettingsDialog({ open, onOpenChange, onImported }: ImportSettingsDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selectedUi, setSelectedUi] = useState<Set<UiPrefCategoryId>>(new Set());
  const [selectedAppSettings, setSelectedAppSettings] = useState(false);
  const [selectedCleanup, setSelectedCleanup] = useState(false);
  const [selectedServices, setSelectedServices] = useState<Set<ServiceType>>(new Set());
  const [selectedSourceDevice, setSelectedSourceDevice] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ replaceAll: boolean } | null>(null);
  const applyImportedUiPrefs = useUIStore((s) => s.applyImportedUiPrefs);

  useEffect(() => {
    if (!open) {
      setParsed(null);
      setFileError(null);
      setSelectedUi(new Set());
      setSelectedAppSettings(false);
      setSelectedCleanup(false);
      setSelectedServices(new Set());
      setSelectedSourceDevice('');
      setPendingConfirm(null);
      return;
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setCurrentEndpoint(sub?.endpoint ?? null))
        .catch(() => setCurrentEndpoint(null));
    } else {
      setCurrentEndpoint(null);
    }
  }, [open]);

  async function handleFile(file: File) {
    setFileError(null);
    setParsed(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setFileError('File too large (max 1 MB).');
      return;
    }
    try {
      const text = await file.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        setFileError('File is not valid JSON.');
        return;
      }
      const result = validateImportFile(raw);
      if (!result.ok) {
        setFileError(result.error);
        return;
      }
      const payload = result.payload;
      const uiPrefsMigrated = buildMigratedUiPrefs(payload);
      const availableUi = (Object.keys(uiPrefsMigrated) as UiPrefCategoryId[])
        .filter((id) => uiPrefsMigrated[id] && Object.keys(uiPrefsMigrated[id]!).length > 0);
      const availableServices = (payload.serviceConnections ?? []).map((c) => c.type);

      setParsed({
        payload,
        warnings: result.warnings,
        uiPrefsMigrated,
        availableUi,
        availableServices,
      });
      setSelectedUi(new Set(availableUi));
      setSelectedAppSettings(!!payload.appSettings);
      setSelectedCleanup(!!payload.cleanup);
      setSelectedServices(new Set(availableServices));
      const devices = payload.notificationPrefs ?? [];
      setSelectedSourceDevice(devices[0]?.deviceName ?? '');
    } catch (err) {
      setFileError((err as Error)?.message || 'Failed to read file.');
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset so the same file can be re-selected
    if (fileRef.current) fileRef.current.value = '';
  }

  function toggleUi(id: UiPrefCategoryId) {
    setSelectedUi((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleService(type: ServiceType) {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  const availableNotifDevices = useMemo(
    () => parsed?.payload.notificationPrefs ?? [],
    [parsed]
  );
  const hasSelection = useMemo(() => (
    !!parsed && (
      selectedUi.size > 0
      || selectedAppSettings
      || selectedCleanup
      || selectedServices.size > 0
      || (!!selectedSourceDevice && availableNotifDevices.length > 0)
    )
  ), [parsed, selectedUi, selectedAppSettings, selectedCleanup, selectedServices, selectedSourceDevice, availableNotifDevices]);

  function requestImport(replaceAll: boolean) {
    if (!parsed) return;
    const willOverwriteSecrets = parsed.payload.includesSecrets && (
      replaceAll
        ? parsed.availableServices.length > 0
        : selectedServices.size > 0
    );
    if (willOverwriteSecrets) {
      setPendingConfirm({ replaceAll });
      return;
    }
    void runImport(replaceAll);
  }

  async function runImport(replaceAll: boolean) {
    if (!parsed) return;
    let useUi = selectedUi;
    let useAppSettings = selectedAppSettings;
    let useCleanup = selectedCleanup;
    let useServices = selectedServices;
    let useDevice = selectedSourceDevice;
    if (replaceAll) {
      useUi = new Set(parsed.availableUi);
      useAppSettings = !!parsed.payload.appSettings;
      useCleanup = !!parsed.payload.cleanup;
      useServices = new Set(parsed.availableServices);
      useDevice = availableNotifDevices[0]?.deviceName ?? '';
      setSelectedUi(useUi);
      setSelectedAppSettings(useAppSettings);
      setSelectedCleanup(useCleanup);
      setSelectedServices(useServices);
      setSelectedSourceDevice(useDevice);
    }

    setImporting(true);
    try {
      // 1. Pre-compute UI prefs merge; defer the local mutation until after the server import succeeds
      //    so a server failure can't leave UI state half-applied.
      let mergedUiPrefs: Record<string, unknown> | null = null;
      if (useUi.size > 0) {
        const merged: Record<string, unknown> = {};
        for (const id of useUi) {
          const cat = parsed.uiPrefsMigrated[id];
          if (cat) Object.assign(merged, cat);
        }
        mergedUiPrefs = merged;
      }

      // 2. Send DB-side parts to import endpoint
      const sourceDevice = availableNotifDevices.find((d) => d.deviceName === useDevice);
      const body: Record<string, unknown> = {};
      if (useAppSettings && parsed.payload.appSettings) {
        body.appSettings = parsed.payload.appSettings;
      }
      if (useServices.size > 0 && parsed.payload.serviceConnections) {
        body.serviceConnections = parsed.payload.serviceConnections.filter((c) =>
          useServices.has(c.type)
        );
      }
      if (sourceDevice) {
        body.notificationDevice = sourceDevice;
        if (currentEndpoint) body.currentDeviceEndpoint = currentEndpoint;
      }
      if (useCleanup && parsed.payload.cleanup) {
        body.cleanup = parsed.payload.cleanup;
      }

      const needsServerCall = body.appSettings || body.serviceConnections || body.notificationDevice || body.cleanup;
      if (needsServerCall) {
        const res = await fetch('/api/settings/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(json?.error || 'Import failed');
        }
        if (mergedUiPrefs) applyImportedUiPrefs(mergedUiPrefs);
        const skipped: string[] = Array.isArray(json?.skipped) ? json.skipped : [];
        if (skipped.length > 0) {
          toast.warning(`Imported with notes: ${skipped.join('; ')}`);
        } else {
          toast.success('Settings imported.');
        }
        if (json?.pollingRestarted === false) {
          toast.warning('Settings imported, but polling did not restart — restart the server to resume notifications.');
        }
      } else if (mergedUiPrefs) {
        applyImportedUiPrefs(mergedUiPrefs);
        toast.success('UI preferences imported.');
      } else {
        toast.info('Nothing to import.');
      }

      onImported?.();
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error)?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Settings</DialogTitle>
          <DialogDescription>
            Pick a settings JSON file, then choose which sections to apply.
          </DialogDescription>
        </DialogHeader>

        {!parsed && (
          <div className="py-4 space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onFileChange}
            />
            <Button
              variant="outline"
              className="w-full h-20 flex-col gap-2"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-5 w-5" />
              <span className="text-sm">Choose a JSON file…</span>
            </Button>
            {fileError && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
                <p className="text-xs text-red-200">{fileError}</p>
              </div>
            )}
          </div>
        )}

        {parsed && (
          <div className="space-y-5 py-2">
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <FileJson className="h-4 w-4 text-muted-foreground" />
              <div className="text-xs text-muted-foreground">
                Exported {new Date(parsed.payload.exportedAt).toLocaleString()}
                {parsed.payload.includesSecrets && ' · contains secrets'}
                {parsed.payload.zustandVersion !== STORE_VERSION && ` · migrated from v${parsed.payload.zustandVersion}`}
              </div>
            </div>

            {parsed.warnings.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                <div className="text-xs text-amber-200 space-y-0.5">
                  {parsed.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              </div>
            )}

            {parsed.availableUi.length > 0 && (
              <section>
                <div className="text-sm font-medium mb-2">UI Preferences</div>
                <div className="space-y-2 ml-1">
                  {parsed.availableUi.map((id) => (
                    <label key={id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={selectedUi.has(id)}
                        onCheckedChange={() => toggleUi(id)}
                      />
                      <span className="text-sm">{UI_PREF_CATEGORY_LABELS[id]}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {parsed.payload.appSettings && (
              <section>
                <label className="flex items-center gap-3 cursor-pointer">
                  <Checkbox
                    checked={selectedAppSettings}
                    onCheckedChange={(v) => setSelectedAppSettings(v === true)}
                  />
                  <div>
                    <div className="text-sm font-medium">App Settings</div>
                    <div className="text-xs text-muted-foreground">
                      Polling intervals, theme, logging, notification timing
                    </div>
                  </div>
                </label>
              </section>
            )}

            {parsed.payload.cleanup && (
              <section>
                <label className="flex items-center gap-3 cursor-pointer">
                  <Checkbox
                    checked={selectedCleanup}
                    onCheckedChange={(v) => setSelectedCleanup(v === true)}
                  />
                  <div>
                    <div className="text-sm font-medium">Cleanup</div>
                    <div className="text-xs text-muted-foreground">
                      Queue &amp; download cleaner configs plus {(parsed.payload.cleanup.stallRules?.length ?? 0)
                      + (parsed.payload.cleanup.slowRules?.length ?? 0)
                      + (parsed.payload.cleanup.seedingRules?.length ?? 0)} rule(s). Replaces existing rules.
                    </div>
                  </div>
                </label>
              </section>
            )}

            {parsed.availableServices.length > 0 && (
              <section>
                <div className="text-sm font-medium mb-2">
                  Service Connections
                  {!parsed.payload.includesSecrets && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (no keys in file — existing keys preserved)
                    </span>
                  )}
                </div>
                <div className="space-y-2 ml-1">
                  {parsed.availableServices.map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={selectedServices.has(type)}
                        onCheckedChange={() => toggleService(type)}
                      />
                      <span className="text-sm">{SERVICE_TYPE_LABELS[type]}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {availableNotifDevices.length > 0 && (
              <section>
                <div className="text-sm font-medium mb-2">Notification Preferences</div>
                <p className="text-xs text-muted-foreground mb-2">
                  Apply rules from this source device to the current browser.
                </p>
                <Select
                  value={selectedSourceDevice}
                  onValueChange={setSelectedSourceDevice}
                  disabled={!currentEndpoint}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a source device…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Don&apos;t import notification prefs</SelectItem>
                    {availableNotifDevices.map((d) => (
                      <SelectItem key={d.deviceName} value={d.deviceName}>
                        {d.deviceName} ({d.rules.length} rules)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!currentEndpoint && (
                  <p className="text-xs text-amber-400 mt-2">
                    No push subscription on this browser. Enable notifications first to import these.
                  </p>
                )}
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          {parsed && (
            <>
              <Button variant="outline" onClick={() => requestImport(true)} disabled={importing}>
                Replace everything
              </Button>
              <Button onClick={() => requestImport(false)} disabled={importing || !hasSelection}>
                {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Apply selected
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
      <Dialog open={pendingConfirm !== null} onOpenChange={(o) => { if (!o) setPendingConfirm(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Overwrite service connections?</DialogTitle>
            <DialogDescription>
              This will overwrite existing service connection API keys with values from the import file. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingConfirm(null)} disabled={importing}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const replaceAll = pendingConfirm?.replaceAll ?? false;
                setPendingConfirm(null);
                void runImport(replaceAll);
              }}
              disabled={importing}
            >
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
