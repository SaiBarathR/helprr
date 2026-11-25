'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, Download, Loader2, MoreVertical, RotateCcw, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GroupedSection } from '@/components/settings/grouped-section';
import { StepUpFields, useStepUp } from '@/components/settings/step-up-fields';
import { PanelLoading, PanelMessage, useTaskRunner, type TaskRuns } from '@/components/settings/arr-system-panels';
import {
  BACKUP_DELETE_PHRASE,
  BACKUP_RESTORE_PHRASE,
  BACKUP_UPLOAD_MAX_BYTES,
  type ArrBackup,
} from '@/lib/arr-system';
import { ensureArray, jsonFetcher, withInstanceQuery } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { formatBytes, formatDistanceToNowShort } from '@/lib/format';
import { formatDateTime } from '@/lib/date-format';
import { saveFile } from '@/lib/save-file';
import { cn } from '@/lib/utils';

const TYPE_LABEL: Record<ArrBackup['type'], string> = {
  scheduled: 'Scheduled backup',
  manual: 'Manual backup',
  update: 'Before an update',
};

type Step =
  | { kind: 'download' | 'restore' | 'delete'; backup: ArrBackup }
  | { kind: 'upload'; file: File };

function backupDetail(backup: ArrBackup): string {
  return `${formatDistanceToNowShort(backup.time)} · ${formatBytes(backup.size)}`;
}

/**
 * System → Backup of one instance: its backups with Download, Restore and
 * Delete, Back up now (the Backup task, so it shares the Tasks tab's run), and
 * Restore from a file. Download, restore and delete ask for the admin's
 * password first (and a typed word for the two that can't be undone), in a
 * step shown in place of the list, so the keyboard works as in any sheet.
 */
export function ArrBackupsPanel({
  instanceId,
  appName,
  runs,
}: {
  instanceId: string;
  appName: string;
  runs: TaskRuns;
}) {
  const query = useQuery({
    queryKey: queryKeys.arrSystem('backups', instanceId),
    queryFn: jsonFetcher<ArrBackup[]>('/api/admin/arr-system/backups', instanceId),
    select: ensureArray<ArrBackup>,
    staleTime: 30_000,
  });
  const { run, isRunning } = useTaskRunner(instanceId, runs);
  const [step, setStep] = useState<Step | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (step) {
    return <BackupStep instanceId={instanceId} appName={appName} step={step} onDone={() => setStep(null)} />;
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Choose a .zip backup', { description: `The one ${appName}'s System → Backup makes.` });
      return;
    }
    if (file.size > BACKUP_UPLOAD_MAX_BYTES) {
      toast.error('That file is too big to restore from Helprr', {
        description: `Helprr takes up to ${formatBytes(BACKUP_UPLOAD_MAX_BYTES)}. Restore it in ${appName}.`,
      });
      return;
    }
    setStep({ kind: 'upload', file });
  }

  const backups = query.data ?? [];
  return (
    <>
      <GroupedSection className="mb-4">
        <div className="grouped-row items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Back up now</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Saves {appName}&apos;s settings and database.</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 pointer-coarse:h-11"
            disabled={isRunning('Backup')}
            onClick={() => void run('Backup', 'Backup')}
          >
            {isRunning('Backup') ? <Loader2 className="animate-spin" /> : <Archive />}
            Back up
          </Button>
        </div>
        <div className="grouped-row items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Restore from a file</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              A .zip from {appName}&apos;s System → Backup, up to {formatBytes(BACKUP_UPLOAD_MAX_BYTES)}.
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 pointer-coarse:h-11"
            onClick={() => fileInput.current?.click()}
          >
            <Upload />
            Choose
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            aria-label="Backup file to restore"
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              // The same file can be picked again after Cancel.
              e.target.value = '';
            }}
          />
        </div>
      </GroupedSection>
      {query.isLoading ? (
        <PanelLoading />
      ) : query.isError ? (
        <PanelMessage>Could not read its backups. It may be offline.</PanelMessage>
      ) : backups.length === 0 ? (
        <PanelMessage>No backups yet.</PanelMessage>
      ) : (
        <GroupedSection
          className="mb-2"
          footer={`Each backup holds ${appName}'s API key and every password it keeps, so downloading, restoring and deleting one ask for your password.`}
        >
          {backups.map((backup) => (
            <div key={backup.id} className="grouped-row items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{TYPE_LABEL[backup.type]}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  <time dateTime={backup.time} title={formatDateTime(backup.time)}>{backupDetail(backup)}</time>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    // 44 px on touch, like the other row actions.
                    className="shrink-0 pointer-coarse:size-11"
                    aria-label={`Actions for the ${TYPE_LABEL[backup.type].toLowerCase()} from ${formatDateTime(backup.time)}`}
                  >
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setStep({ kind: 'download', backup })}>
                    <Download /> Download
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStep({ kind: 'restore', backup })}>
                    <RotateCcw /> Restore
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setStep({ kind: 'delete', backup })}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </GroupedSection>
      )}
    </>
  );
}

const STEP_COPY = {
  download: { title: 'Download this backup?', action: 'Download', phrase: null },
  restore: { title: 'Restore this backup?', action: 'Restore', phrase: BACKUP_RESTORE_PHRASE },
  delete: { title: 'Delete this backup?', action: 'Delete', phrase: BACKUP_DELETE_PHRASE },
  upload: { title: 'Restore from this file?', action: 'Restore', phrase: BACKUP_RESTORE_PHRASE },
} as const;

/** What a step does, in the words the admin confirms. */
function consequence(step: Step, appName: string): string {
  switch (step.kind) {
    case 'download':
      return `The zip holds ${appName}'s API key and every password it keeps (indexers, download clients, notifications). Keep it somewhere safe.`;
    case 'delete':
      return `The file is removed from ${appName}'s disk. This can't be undone.`;
    case 'restore':
    case 'upload':
      return `Everything changed in ${appName} since the backup is lost: settings, library and history. ${appName} restarts to finish. A backup from another install brings its API key, and Helprr can't reach ${appName} until you enter that key in Settings.`;
  }
}

/**
 * One backup step, in place of the list: what it does, the typed word for a
 * restore or delete, and the admin's password (and code). The route checks
 * all of them again.
 */
function BackupStep({
  instanceId,
  appName,
  step,
  onDone,
}: {
  instanceId: string;
  appName: string;
  step: Step;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const stepUp = useStepUp();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = STEP_COPY[step.kind];
  const typedOk = copy.phrase === null || typed.trim().toUpperCase() === copy.phrase;
  const destructive = step.kind !== 'download';
  const canSubmit = !busy && typedOk && stepUp.ready;

  async function submit() {
    setBusy(true);
    try {
      let res: Response;
      if (step.kind === 'upload') {
        const form = new FormData();
        form.append('confirm', BACKUP_RESTORE_PHRASE);
        const factors = stepUp.body();
        form.append('currentPassword', factors.currentPassword);
        if (factors.code) form.append('code', factors.code);
        form.append('file', step.file, step.file.name);
        res = await fetch(withInstanceQuery('/api/admin/arr-system/backups/upload', instanceId), { method: 'POST', body: form });
      } else {
        const path = step.kind === 'delete'
          ? `/api/admin/arr-system/backups/${step.backup.id}`
          : `/api/admin/arr-system/backups/${step.backup.id}/${step.kind}`;
        res = await fetch(withInstanceQuery(path, instanceId), {
          method: step.kind === 'delete' ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...stepUp.body(), ...(copy.phrase && { confirm: copy.phrase }) }),
        });
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; field?: string; needsStepUp?: boolean; needsCode?: boolean };
        // A wrong password or code shows under its field; anything else in a toast.
        if (!stepUp.onRefused(data, res.status)) toast.error(`${copy.action} failed`, { description: data.error });
        return;
      }
      if (step.kind === 'download') {
        await saveFile(await res.blob(), step.backup.name);
      } else if (step.kind === 'delete') {
        toast.success('Backup deleted');
      } else {
        const data = (await res.json().catch(() => ({}))) as { restarted?: boolean };
        toast.success('Backup restored', {
          description: data.restarted ? `${appName} is restarting to finish.` : `Restart ${appName} to finish.`,
        });
      }
      stepUp.clear();
      onDone();
    } catch {
      toast.error(`${copy.action} failed`);
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.arrSystem('backups', instanceId) });
    }
  }

  return (
    <form
      className="mb-2 space-y-4 px-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) void submit();
      }}
    >
      <div>
        <h3 className="text-base font-semibold">{copy.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {step.kind === 'upload'
            ? `${step.file.name} · ${formatBytes(step.file.size)}`
            : `${TYPE_LABEL[step.backup.type]}, ${formatDateTime(step.backup.time)} · ${formatBytes(step.backup.size)}`}
        </p>
      </div>
      <div
        className={cn(
          'flex gap-2 rounded-lg border p-3 text-sm',
          destructive ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-muted/30',
        )}
      >
        <AlertTriangle
          aria-hidden
          className={cn('mt-0.5 h-4 w-4 shrink-0', destructive ? 'text-red-400 light:text-red-700' : 'text-amber-400 light:text-amber-700')}
        />
        <p>{consequence(step, appName)}</p>
      </div>
      {copy.phrase && (
        <div className="space-y-1.5">
          <label htmlFor="backup-confirm-phrase" className="text-sm text-muted-foreground">
            Type <span className="font-mono font-semibold text-foreground">{copy.phrase}</span> to confirm.
          </label>
          <Input
            id="backup-confirm-phrase"
            value={typed}
            disabled={busy}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder={copy.phrase}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      )}
      <StepUpFields
        stepUp={stepUp}
        reason={step.kind === 'download' ? 'The file holds every password it keeps.' : 'This changes the app itself.'}
      />
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant={destructive ? 'destructive' : 'default'} className="flex-1" disabled={!canSubmit}>
          {busy && <Loader2 className="animate-spin" />}
          {copy.action}
        </Button>
      </div>
    </form>
  );
}
