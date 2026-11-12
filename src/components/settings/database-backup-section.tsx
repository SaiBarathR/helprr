'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { formatBytes, formatDistanceToNowSafe, hourLabel } from '@/lib/format';
import { BACKUP_GUIDE_URL } from '@/lib/docs-links';
import { cn } from '@/lib/utils';

/** A recorded backup older than this is shown in amber, as is none at all. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** How often the page asks while a backup runs. */
const RUNNING_POLL_MS = 2000;

type Schedule = 'off' | 'daily' | 'weekly';

interface ScheduleSettings {
  schedule: Schedule;
  hour: number;
  dayOfWeek: number;
  keep: number;
  alertDays: number;
}

type RunResult =
  | { ok: true; fileName: string; sizeBytes: number; finishedAt: string }
  | { ok: false; reason: string; message: string; finishedAt: string };

interface BackupStatus extends Partial<ScheduleSettings> {
  lastBackupAt: string | null;
  folder?: { ok: true } | { ok: false; reason: 'missing' | 'not-mounted' | 'not-writable' };
  backups?: Array<{ name: string; sizeBytes: number; createdAt: string }>;
  running?: boolean;
  lastRun?: RunResult | null;
  timeZone?: string;
}

const FOLDER_PROBLEM: Record<'missing' | 'not-mounted' | 'not-writable', string> = {
  missing: 'No backup folder',
  'not-mounted': 'Backup folder not mounted',
  'not-writable': 'Backup folder not writable',
};

const SCHEDULE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

const DAY_OF_WEEK_OPTIONS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const KEEP_OPTIONS = [3, 5, 7, 10, 14, 30];
const ALERT_OPTIONS = [0, 2, 3, 7, 14, 30];

const SELECT_TRIGGER =
  'w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5';

// backup.sh writes its dumps to its own folder, so only Last database backup
// shows its runs; "On the server" lists Helprr's own files.
const FOOTER =
  'Saved in the backup folder on the server, never downloaded. Last database backup counts backup.sh runs too; their files stay where backup.sh saves them.';

function withCurrent(options: number[], current: number): number[] {
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

function SettingSelect({ label, value, options, onChange, disabled }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="grouped-row">
      <span className="text-sm">{label}</span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className={SELECT_TRIGGER} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * The database backups (Settings → Backup & Restore, admins): when the last one
 * was made, Back up now, the schedule, and the dumps in the server's backup folder.
 */
export function DatabaseBackupSection() {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.adminDatabaseBackup();
  const { data, dataUpdatedAt, isError } = useQuery({
    queryKey,
    queryFn: jsonFetcher<BackupStatus>('/api/admin/database-backup'),
    refetchInterval: (query) => (query.state.data?.running ? RUNNING_POLL_MS : false),
  });
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  // The run this page started, told apart from an earlier one by its finish time.
  const awaiting = useRef<{ previous: string | null } | null>(null);

  const last = data?.lastBackupAt ?? null;
  // None, or an old one; judged at the time of the read, not of this render.
  const stale = data !== undefined && (last === null || dataUpdatedAt - Date.parse(last) > STALE_MS);
  const running = Boolean(data?.running);
  const folder = data?.folder;
  const schedule = data?.schedule ?? 'off';

  useEffect(() => {
    const run = data?.lastRun;
    if (!awaiting.current || data?.running || !run || run.finishedAt === awaiting.current.previous) return;
    awaiting.current = null;
    if (run.ok) toast.success(`Backed up the database: ${run.fileName}`);
    else toast.error(run.message);
  }, [data]);

  async function backUpNow() {
    setStarting(true);
    try {
      const res = await fetch('/api/admin/database-backup', { method: 'POST' });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(payload?.error || 'Could not start the backup');
        return;
      }
      awaiting.current = { previous: data?.lastRun?.finishedAt ?? null };
      await queryClient.invalidateQueries({ queryKey });
    } catch {
      toast.error('Could not start the backup');
    } finally {
      setStarting(false);
    }
  }

  async function save(change: Partial<ScheduleSettings>) {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/database-backup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(payload?.error || 'Could not save the backup schedule');
        return;
      }
      queryClient.setQueryData<BackupStatus>(queryKey, (old) => (old ? { ...old, ...payload } : old));
    } catch {
      toast.error('Could not save the backup schedule');
    } finally {
      setSaving(false);
    }
  }

  let backUpHint = 'Saved to the backup folder on the server';
  if (running) backUpHint = 'Backing up…';
  else if (folder && !folder.ok) backUpHint = FOLDER_PROBLEM[folder.reason];
  const canBackUp = folder?.ok === true && !running && !starting;
  const settingsReady = data?.schedule !== undefined;

  return (
    <>
      <GroupedSection title="Database" footer={FOOTER}>
        <div className="grouped-row">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-md shrink-0 bg-emerald-500/10 text-emerald-400">
              <DatabaseBackup className="h-[18px] w-[18px]" />
            </span>
            {/* The age goes under the label, as Back up now's hint does: beside it,
                "less than a minute ago" left a phone too little room for the label. */}
            <div className="flex flex-col items-start min-w-0">
              <span className="text-[15px] font-medium">Last database backup</span>
              <span
                className={cn(
                  'text-xs',
                  stale ? 'text-amber-400 light:text-amber-700' : 'text-muted-foreground',
                )}
              >
                {data ? (last ? formatDistanceToNowSafe(last) : 'None recorded') : isError ? 'Unavailable' : '…'}
              </span>
            </div>
          </div>
        </div>
        {folder && (
          <button
            type="button"
            onClick={() => void backUpNow()}
            disabled={!canBackUp}
            className="grouped-row w-full text-left active:bg-foreground/5 transition-colors disabled:active:bg-transparent"
          >
            <div className="flex flex-col items-start min-w-0 flex-1">
              <span className={cn('text-[15px] font-medium', canBackUp ? 'text-primary' : 'text-muted-foreground')}>
                Back up now
              </span>
              <span
                className={cn(
                  'text-xs',
                  !folder.ok ? 'text-amber-400 light:text-amber-700' : 'text-muted-foreground',
                )}
              >
                {backUpHint}
              </span>
            </div>
            {(running || starting) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
          </button>
        )}
        <a
          href={BACKUP_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="grouped-row w-full text-left active:bg-foreground/5 transition-colors"
        >
          <div className="flex flex-col items-start min-w-0 flex-1">
            <span className="text-[15px] font-medium">How to back up and restore</span>
            <span className="text-xs text-muted-foreground">
              {folder && !folder.ok ? 'How to add the backup folder, and restore' : 'Restore, and keep a copy off the server'}
            </span>
          </div>
          <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
        </a>
      </GroupedSection>

      {settingsReady && (
        <GroupedSection
          title="Scheduled backups"
          footer={`Keeps the newest backups Helprr made. Admins get a push when a scheduled backup fails or the last backup is older than the alert. Times are in ${data?.timeZone ?? 'UTC'}.`}
        >
          <SettingSelect
            label="Frequency"
            value={schedule}
            options={SCHEDULE_OPTIONS}
            onChange={(v) => void save({ schedule: v as Schedule })}
            disabled={saving}
          />
          {schedule !== 'off' && (
            <SettingSelect
              label="At"
              value={String(data?.hour ?? 3)}
              options={Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: hourLabel(i) }))}
              onChange={(v) => void save({ hour: parseInt(v, 10) })}
              disabled={saving}
            />
          )}
          {schedule === 'weekly' && (
            <SettingSelect
              label="Day"
              value={String(data?.dayOfWeek ?? 0)}
              options={DAY_OF_WEEK_OPTIONS.map((label, i) => ({ value: String(i), label }))}
              onChange={(v) => void save({ dayOfWeek: parseInt(v, 10) })}
              disabled={saving}
            />
          )}
          <SettingSelect
            label="Keep"
            value={String(data?.keep ?? 7)}
            options={withCurrent(KEEP_OPTIONS, data?.keep ?? 7).map((n) => ({ value: String(n), label: `Newest ${n}` }))}
            onChange={(v) => void save({ keep: parseInt(v, 10) })}
            disabled={saving}
          />
          <SettingSelect
            label="Alert when older than"
            value={String(data?.alertDays ?? 7)}
            options={withCurrent(ALERT_OPTIONS, data?.alertDays ?? 7).map((n) => ({
              value: String(n),
              label: n === 0 ? 'Never' : `${n} days`,
            }))}
            onChange={(v) => void save({ alertDays: parseInt(v, 10) })}
            disabled={saving}
          />
        </GroupedSection>
      )}

      {folder?.ok && (
        <GroupedSection title="On the server" footer="Restore one from a shell on the server; the guide has the steps.">
          {(data?.backups ?? []).length === 0 ? (
            <div className="grouped-row">
              <span className="text-sm text-muted-foreground">No backups made by Helprr yet</span>
            </div>
          ) : (
            data?.backups?.map((file) => (
              // Size and age under the name: beside it they cut off the name's date
              // and time on a phone, the part that tells the files apart.
              <div key={file.name} className="grouped-row">
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm truncate">{file.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(file.sizeBytes)} · {formatDistanceToNowSafe(file.createdAt)}
                  </span>
                </div>
              </div>
            ))
          )}
        </GroupedSection>
      )}
    </>
  );
}
