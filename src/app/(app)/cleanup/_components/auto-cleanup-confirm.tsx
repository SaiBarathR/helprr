'use client';

import { useQuery } from '@tanstack/react-query';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { jsonFetcher } from '@/lib/query-fetch';
import type { AutoRunMode } from '@/lib/cleanup/types';

interface CleanerState {
  enabled: boolean;
  autoRunMode: AutoRunMode;
}

/**
 * Whether saving `next` starts automatic deletion that `saved` did not have.
 * A cleaner deletes on its own only with its master switch on and auto-run set
 * to enabled, so turning either of them on can be the step that starts it.
 */
export function startsAutomaticDeletion(saved: CleanerState | null | undefined, next: CleanerState): boolean {
  const deletes = (state: CleanerState) => state.enabled && state.autoRunMode === 'enabled';
  return deletes(next) && !(saved && deletes(saved));
}

const CLEANER_NAMES = { queue: 'Queue Cleaner', download: 'Download Cleaner' } as const;

// What a removal deletes. A queue removal takes the download's data with it
// (a private torrent only when its rule allows that); a seeding rule decides
// for itself whether the files go.
const WHAT_GOES = {
  queue: 'removes them along with what they had downloaded',
  download: 'removes them and, where a rule says so, deletes their files from disk',
} as const;

function everyInterval(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? 'every hour' : `every ${hours} hours`;
  }
  return minutes === 1 ? 'every minute' : `every ${minutes} minutes`;
}

/**
 * The second confirmation before a save turns on automatic deletion. It
 * recommends a dry run first when none is on record, but does not require one.
 */
export function AutoCleanupConfirmDialog({
  open,
  onOpenChange,
  cleaner,
  intervalMinutes,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cleaner: 'queue' | 'download';
  intervalMinutes: number;
  busy: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  // Dry-run cycles record what they would have removed as dryRunPreview rows.
  const dryRuns = useQuery({
    queryKey: ['cleanup', 'dry-run-history', cleaner],
    queryFn: jsonFetcher<{ total: number }>(`/api/cleanup/history?cleaner=${cleaner}&action=dryRunPreview&pageSize=1`),
    enabled: open,
    staleTime: 0,
  });
  const name = CLEANER_NAMES[cleaner];

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Turn on automatic deletion for the ${name}?`}
      description={
        <span className="space-y-3">
          <span className="block">
            Once saved, the {name} acts on downloads that match its rules {everyInterval(intervalMinutes)} without
            asking: it {WHAT_GOES[cleaner]}.
          </span>
          {dryRuns.data?.total === 0 && (
            <span className="block text-amber-600 dark:text-amber-500">
              No dry-run results are on record for this cleaner. We recommend running it in Dry-run mode first and
              checking Cleanup → History for what it would remove.
            </span>
          )}
        </span>
      }
      confirmLabel="Turn on and save"
      destructive
      busy={busy}
      onConfirm={onConfirm}
    />
  );
}
