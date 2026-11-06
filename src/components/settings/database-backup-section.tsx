'use client';

import { useQuery } from '@tanstack/react-query';
import { DatabaseBackup, ExternalLink } from 'lucide-react';
import { GroupedSection } from '@/components/settings/grouped-section';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { formatDistanceToNowSafe } from '@/lib/format';
import { BACKUP_GUIDE_URL } from '@/lib/docs-links';
import { cn } from '@/lib/utils';

/** A recorded backup older than this is shown in amber. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

const FOOTER =
  'Made on the server with backup.sh, which records each one here. Backups made another way, such as by your dashboard app, are not shown.';

/** When scripts/backup.sh last backed up the database (Settings → Backup & Restore, admins). */
export function DatabaseBackupSection() {
  const { data, dataUpdatedAt, isError } = useQuery({
    queryKey: queryKeys.adminDatabaseBackup(),
    queryFn: jsonFetcher<{ lastBackupAt: string | null }>('/api/admin/database-backup'),
  });
  const last = data?.lastBackupAt ?? null;
  // Judged at the time of the read, not of this render.
  const stale = last !== null && dataUpdatedAt - Date.parse(last) > STALE_MS;

  return (
    <GroupedSection title="Database" footer={FOOTER}>
      <div className="grouped-row">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-md shrink-0 bg-emerald-500/10 text-emerald-400">
            <DatabaseBackup className="h-[18px] w-[18px]" />
          </span>
          <span className="text-[15px] font-medium truncate">Last database backup</span>
        </div>
        <span
          className={cn(
            'shrink-0 text-sm',
            stale ? 'text-amber-400 light:text-amber-700' : 'text-muted-foreground',
          )}
        >
          {data ? (last ? formatDistanceToNowSafe(last) : 'None recorded') : isError ? 'Unavailable' : '…'}
        </span>
      </div>
      <a
        href={BACKUP_GUIDE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="grouped-row w-full text-left active:bg-foreground/5 transition-colors"
      >
        <div className="flex flex-col items-start min-w-0 flex-1">
          <span className="text-[15px] font-medium">How to back up and restore</span>
          <span className="text-xs text-muted-foreground">Run it on a schedule, and keep a copy off the server</span>
        </div>
        <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
      </a>
    </GroupedSection>
  );
}
