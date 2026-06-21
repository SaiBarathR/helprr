'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MediaManagementConfig } from '@/types';

// Permanent single-file deletes above this size escalate to type-to-confirm too —
// losing a 30 GiB remux on a mistap warrants the same friction as a bulk delete.
const LARGE_DELETE_BYTES = 20 * 1024 * 1024 * 1024; // 20 GiB

// The phrase the user types to confirm a permanent bulk delete. Kept short and
// fixed (not the title) so it's tappable on an iPhone keyboard.
const CONFIRM_PHRASE = 'DELETE';

export interface DeleteFilesConfirmDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: 'sonarr' | 'radarr';
  fileCount: number;
  /** Sum of the selected files' sizes, for the summary + large-delete escalation. */
  totalBytes?: number;
  /**
   * Media-management config (recycle-bin / auto-unmonitor). `undefined` while the
   * fetch is in flight; `null` when the fetch failed (we then fail SAFE — treat
   * the delete as permanent and require the strongest confirmation).
   */
  config: MediaManagementConfig | null | undefined;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function DeleteFilesConfirmDrawer({
  open,
  onOpenChange,
  service,
  fileCount,
  totalBytes,
  config,
  busy = false,
  onConfirm,
}: DeleteFilesConfirmDrawerProps) {
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [typed, setTyped] = React.useState('');

  // Reset the gates every time the dialog opens so a prior confirmation can't
  // carry over into the next delete.
  React.useEffect(() => {
    if (open) {
      setAcknowledged(false);
      setTyped('');
    }
  }, [open]);

  const configLoading = config === undefined;
  const configFailed = config === null;
  const recycleBinConfigured = !!config?.recycleBin?.trim();
  // Permanent when we KNOW there's no bin, OR when we couldn't read the config
  // (don't promise recoverability we can't verify).
  const permanent = configFailed || (config != null && !recycleBinConfigured);
  const isBulk = fileCount > 1 || (totalBytes ?? 0) >= LARGE_DELETE_BYTES;

  const needsAcknowledge = permanent;
  const needsTypeConfirm = permanent && isBulk;
  const typeConfirmOk = !needsTypeConfirm || typed.trim().toUpperCase() === CONFIRM_PHRASE;
  const ackOk = !needsAcknowledge || acknowledged;
  const canConfirm = !busy && !configLoading && ackOk && typeConfirmOk;

  const unmonitorNote =
    service === 'sonarr'
      ? config?.autoUnmonitorPreviouslyDownloadedEpisodes
        ? 'The affected episode(s) will be unmonitored.'
        : 'Episode monitoring is unchanged.'
      : 'Movie monitoring is unchanged.';

  const fileLabel = fileCount === 1 ? 'file' : 'files';

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return; // never let a dismiss interrupt an in-flight delete
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Delete {fileCount} {fileLabel}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {totalBytes != null && totalBytes > 0
              ? `Removing ${formatBytes(totalBytes)} across ${fileCount} ${fileLabel}.`
              : `Removing ${fileCount} ${fileLabel} from disk.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Consequence card — what actually happens on disk. */}
        <div
          className={cn(
            'rounded-lg border p-3 text-sm',
            configLoading && 'border-border bg-muted/30 text-muted-foreground',
            !configLoading && permanent && 'border-destructive/40 bg-destructive/10',
            !configLoading && !permanent && 'border-border bg-muted/30'
          )}
        >
          {configLoading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking deletion safety…
            </span>
          ) : permanent ? (
            <div className="space-y-1">
              <span className="flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {configFailed
                  ? "Couldn't verify the Recycle Bin — treating this as permanent."
                  : 'No Recycle Bin configured — files are deleted permanently from disk.'}
              </span>
              <p className="text-muted-foreground">This cannot be undone. {unmonitorNote}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <span className="flex items-center gap-2 font-medium text-foreground">
                <RotateCcw className="h-4 w-4 shrink-0" />
                Files will be moved to the Recycle Bin.
              </span>
              <p className="text-muted-foreground">Recoverable from the bin. {unmonitorNote}</p>
            </div>
          )}
        </div>

        {needsAcknowledge && !configLoading && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={acknowledged}
              disabled={busy}
              onCheckedChange={(v) => setAcknowledged(v === true)}
            />
            <span>I understand this permanently deletes {fileCount === 1 ? 'this file' : 'these files'}.</span>
          </label>
        )}

        {needsTypeConfirm && !configLoading && (
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">
              Type <span className="font-mono font-semibold text-foreground">{CONFIRM_PHRASE}</span> to
              confirm.
            </label>
            <Input
              value={typed}
              disabled={busy}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder={CONFIRM_PHRASE}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm}
            className={buttonVariants({ variant: 'destructive' })}
            onClick={(event) => {
              event.preventDefault();
              if (!canConfirm) return;
              void onConfirm();
            }}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {permanent ? 'Delete permanently' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
