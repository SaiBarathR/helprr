'use client';

import Link from 'next/link';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { Badge } from '@/components/ui/badge';
import { formatBytes } from '@/lib/format';

interface AuditRecord {
  id: string;
  username: string;
  service: 'SONARR' | 'RADARR';
  instanceId: string | null;
  operation: 'EDIT' | 'DELETE' | 'IMPORT';
  mediaType: string;
  mediaId: number;
  mediaTitle: string;
  fileCount: number;
  details: Record<string, unknown> | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

const OP_VARIANT: Record<AuditRecord['operation'], 'default' | 'secondary' | 'destructive'> = {
  EDIT: 'secondary',
  IMPORT: 'default',
  DELETE: 'destructive',
};

function timeAgo(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNow(d, { addSuffix: true });
}

export default function FileAuditPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['file-audit'],
    queryFn: jsonFetcher<{ records: AuditRecord[]; total: number }>('/api/file-audit'),
  });
  const records = data?.records ?? [];

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link href="/settings" className="-ml-1 inline-flex min-h-[44px] items-center gap-1 px-1 text-sm text-primary">
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>

      <div className="mb-4 px-4">
        <h1 className="text-2xl font-semibold">File operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Audit trail of Manage Episodes / Manage Files edits, deletes, and imports.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : isError ? (
        <p className="px-4 py-10 text-center text-sm text-destructive">Failed to load the audit log.</p>
      ) : records.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">No file operations recorded yet.</p>
      ) : (
        <div className="space-y-2 px-4">
          {records.map((r) => {
            const paths = Array.isArray(r.details?.paths) ? (r.details!.paths as string[]) : null;
            const totalBytes = typeof r.details?.totalBytes === 'number' ? (r.details!.totalBytes as number) : null;
            const fields = Array.isArray(r.details?.fields) ? (r.details!.fields as string[]) : null;
            return (
              <div key={r.id} className="rounded-xl border bg-muted/30 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={OP_VARIANT[r.operation]} className="text-[10px]">{r.operation}</Badge>
                    {!r.success && <Badge variant="destructive" className="text-[10px]">Failed</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {r.service === 'SONARR' ? 'Sonarr' : 'Radarr'}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
                </div>
                <p className="mt-1.5 break-words text-sm font-medium leading-snug">{r.mediaTitle}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {r.fileCount} file{r.fileCount === 1 ? '' : 's'}
                  {fields?.length ? ` · ${fields.join(', ')}` : ''}
                  {totalBytes != null ? ` · ${formatBytes(totalBytes)}` : ''}
                  {' · by '}{r.username}
                </p>
                {paths?.length ? (
                  <p className="mt-1 break-all text-[11px] font-mono text-muted-foreground/80">
                    {paths.slice(0, 3).join(' • ')}{paths.length > 3 ? ` • +${paths.length - 3} more` : ''}
                  </p>
                ) : null}
                {!r.success && r.errorMessage && (
                  <p className="mt-1 text-xs text-destructive">{r.errorMessage}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
