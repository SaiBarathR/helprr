'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GroupedSection } from '@/components/settings/grouped-section';
import { useAppSettings, type AppSettingsState } from '@/lib/hooks/use-app-settings';
import {
  CLIENT_LOG_SETTINGS_EVENT,
  type ClientLogCaptureSettingsEvent,
} from '@/components/client-log-capture';

const LOG_LEVEL_OPTIONS: { value: AppSettingsState['logLevel']; label: string; hint: string }[] = [
  { value: 'debug', label: 'Debug', hint: 'capture everything' },
  { value: 'info', label: 'Info', hint: 'info, warnings, errors' },
  { value: 'warn', label: 'Warn', hint: 'warnings & errors only' },
  { value: 'error', label: 'Error', hint: 'errors only' },
];

function dispatchClientLogSettings(detail: ClientLogCaptureSettingsEvent) {
  window.dispatchEvent(new CustomEvent(CLIENT_LOG_SETTINGS_EVENT, { detail }));
}

export default function LoggingSettingsPage() {
  const { settings, loading, update } = useAppSettings();
  const previousLogEnabled = useRef<boolean | null>(null);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [purgingLogs, setPurgingLogs] = useState(false);

  const [maxFileMbDraft, setMaxFileMbDraft] = useState('');
  const [retentionDaysDraft, setRetentionDaysDraft] = useState('');
  const lastSyncedMaxFileMb = useRef<number | null>(null);
  const lastSyncedRetentionDays = useRef<number | null>(null);
  const maxFileMbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retentionDaysTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!settings) return;
    if (previousLogEnabled.current === null) {
      previousLogEnabled.current = settings.logEnabled;
    }
    if (settings.logMaxFileMb !== lastSyncedMaxFileMb.current) {
      setMaxFileMbDraft(String(settings.logMaxFileMb));
      lastSyncedMaxFileMb.current = settings.logMaxFileMb;
    }
    if (settings.logRetentionDays !== lastSyncedRetentionDays.current) {
      setRetentionDaysDraft(String(settings.logRetentionDays));
      lastSyncedRetentionDays.current = settings.logRetentionDays;
    }
  }, [settings]);

  async function handleToggleEnabled(next: boolean) {
    const wasEnabled = previousLogEnabled.current;
    const result = await update({ logEnabled: next });
    if (!result) return;
    previousLogEnabled.current = next;
    dispatchClientLogSettings({
      logEnabled: result.logEnabled,
      logClientConsoleEnabled: result.logClientConsoleEnabled,
    });
    if (wasEnabled === true && next === false) {
      setPurgeConfirmOpen(true);
    }
  }

  async function handleClientConsole(next: boolean) {
    const result = await update({ logClientConsoleEnabled: next });
    if (!result) return;
    dispatchClientLogSettings({
      logEnabled: result.logEnabled,
      logClientConsoleEnabled: result.logClientConsoleEnabled,
    });
  }

  function handleMaxFileMbDraft(value: string) {
    setMaxFileMbDraft(value);
    if (maxFileMbTimer.current) clearTimeout(maxFileMbTimer.current);
    maxFileMbTimer.current = setTimeout(() => {
      const parsed = parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1024) {
        toast.error('Rotate at must be between 1 and 1024 MB');
        if (settings) setMaxFileMbDraft(String(settings.logMaxFileMb));
        return;
      }
      void update({ logMaxFileMb: parsed });
    }, 700);
  }

  function handleRetentionDaysDraft(value: string) {
    setRetentionDaysDraft(value);
    if (retentionDaysTimer.current) clearTimeout(retentionDaysTimer.current);
    retentionDaysTimer.current = setTimeout(() => {
      const parsed = parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3650) {
        toast.error('Retention must be between 1 and 3650 days');
        if (settings) setRetentionDaysDraft(String(settings.logRetentionDays));
        return;
      }
      void update({ logRetentionDays: parsed });
    }, 700);
  }

  async function purgeAllLogs() {
    setPurgingLogs(true);
    try {
      const res = await fetch('/api/logs/files?all=true', { method: 'DELETE' });
      const payload = await res.json().catch(() => null);
      const deleted = typeof payload?.deleted === 'number' ? payload.deleted : 0;
      if (!res.ok) {
        const base = payload?.error || 'Failed to delete log files';
        toast.error(deleted > 0 ? `${base} (deleted ${deleted} before failing)` : base);
        return;
      }
      toast.success(deleted === 0 ? 'No log files to delete' : `Deleted ${deleted} log file${deleted === 1 ? '' : 's'}`);
    } catch {
      toast.error('Failed to delete log files');
    } finally {
      setPurgingLogs(false);
      setPurgeConfirmOpen(false);
    }
  }

  const logEnabled = settings?.logEnabled ?? true;

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>

      <div className="px-4 mb-4">
        <h1 className="text-2xl font-semibold">Logging</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Server-side log capture. Changes save automatically.
        </p>
      </div>

      <GroupedSection title="Capture" footer="Synced across devices">
        <div className="grouped-row">
          <span className="text-sm">Enable logging</span>
          <Switch
            checked={logEnabled}
            onCheckedChange={handleToggleEnabled}
            disabled={loading}
            aria-label="Enable Logging"
          />
        </div>

        <fieldset disabled={!logEnabled} className={!logEnabled ? 'opacity-50' : undefined}>
          <div className="grouped-row">
            <span className="text-sm">Level</span>
            <Select
              value={settings?.logLevel ?? 'debug'}
              onValueChange={(v) => void update({ logLevel: v as AppSettingsState['logLevel'] })}
              disabled={loading || !logEnabled}
            >
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOG_LEVEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="flex flex-col items-start">
                      <span>{o.label}</span>
                      <span className="text-xs text-muted-foreground">{o.hint}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </fieldset>
      </GroupedSection>

      <GroupedSection title="File rotation" footer="Synced across devices">
        <fieldset disabled={!logEnabled} className={!logEnabled ? 'opacity-50' : undefined}>
          <div className="px-4 py-3 border-b border-[oklch(1_0_0/6%)] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Rotate at (MB)</Label>
            <Input
              type="number"
              min={1}
              max={1024}
              value={maxFileMbDraft}
              onChange={(e) => handleMaxFileMbDraft(e.target.value)}
              className="h-10"
              disabled={!logEnabled}
            />
          </div>
          <div className="px-4 py-3 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Retention (days)</Label>
            <Input
              type="number"
              min={1}
              max={3650}
              value={retentionDaysDraft}
              onChange={(e) => handleRetentionDaysDraft(e.target.value)}
              className="h-10"
              disabled={!logEnabled}
            />
          </div>
        </fieldset>
      </GroupedSection>

      <GroupedSection title="Verbosity" footer="Synced across devices">
        <fieldset disabled={!logEnabled} className={!logEnabled ? 'opacity-50' : undefined}>
          <div className="grouped-row">
            <span className="text-sm">Client console</span>
            <Switch
              checked={settings?.logClientConsoleEnabled ?? true}
              onCheckedChange={handleClientConsole}
              disabled={loading || !logEnabled}
              aria-label="Client Console Logging"
            />
          </div>
          <div className="grouped-row">
            <span className="text-sm">Failed request bodies</span>
            <Switch
              checked={settings?.logFailedRequestBodies ?? false}
              onCheckedChange={(v) => void update({ logFailedRequestBodies: v })}
              disabled={loading || !logEnabled}
              aria-label="Failed Request Bodies"
            />
          </div>
          <div className="grouped-row">
            <span className="text-sm">Failed response bodies</span>
            <Switch
              checked={settings?.logFailedResponseBodies ?? false}
              onCheckedChange={(v) => void update({ logFailedResponseBodies: v })}
              disabled={loading || !logEnabled}
              aria-label="Failed Response Bodies"
            />
          </div>
        </fieldset>
      </GroupedSection>

      <GroupedSection title="Files" footer="Server action — affects all devices">
        <div className="px-4 py-3">
          <Button
            variant="outline"
            className="w-full h-9"
            onClick={() => setPurgeConfirmOpen(true)}
            disabled={purgingLogs}
          >
            {purgingLogs ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Deleting…
              </>
            ) : (
              'Delete all log files'
            )}
          </Button>
        </div>
      </GroupedSection>

      <ConfirmDialog
        open={purgeConfirmOpen}
        onOpenChange={setPurgeConfirmOpen}
        title="Delete log files on disk?"
        description="Existing log files in /logs will be permanently deleted. This cannot be undone."
        confirmLabel="Yes, delete log files"
        cancelLabel="Keep files"
        destructive
        busy={purgingLogs}
        onConfirm={purgeAllLogs}
      />
    </div>
  );
}
