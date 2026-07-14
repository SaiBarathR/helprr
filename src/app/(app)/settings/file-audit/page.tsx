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
  service: 'SONARR' | 'RADARR' | 'LIDARR' | 'QBITTORRENT';
  instanceId: string | null;
  operation: 'EDIT' | 'DELETE' | 'IMPORT' | 'DELETE_MEDIA' | 'DELETE_TORRENT' | 'REMOVE_QUEUE';
  mediaType: string;
  mediaId: number | null;
  mediaTitle: string;
  fileCount: number;
  filesDeleted: boolean | null;
  details: Record<string, unknown> | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

const OP_VARIANT: Record<AuditRecord['operation'], 'default' | 'secondary' | 'destructive'> = {
  EDIT: 'secondary',
  IMPORT: 'default',
  DELETE: 'destructive',
  DELETE_MEDIA: 'destructive',
  DELETE_TORRENT: 'destructive',
  REMOVE_QUEUE: 'destructive',
};

const OP_LABEL: Record<AuditRecord['operation'], string> = {
  EDIT: 'EDIT',
  IMPORT: 'IMPORT',
  DELETE: 'FILE DELETE',
  DELETE_MEDIA: 'MEDIA DELETE',
  DELETE_TORRENT: 'TORRENT DELETE',
  REMOVE_QUEUE: 'QUEUE REMOVE',
};

function serviceLabel(service: AuditRecord['service']): string {
  if (service === 'QBITTORRENT') return 'qBittorrent';
  return service[0] + service.slice(1).toLowerCase();
}

function countLabel(record: AuditRecord): string {
  const count = record.fileCount;
  if (record.operation === 'DELETE_MEDIA') {
    const noun = record.mediaType === 'series' ? 'series' : record.mediaType;
    return `${count} ${noun}${count === 1 || noun === 'series' ? '' : 's'}`;
  }
  if (record.operation === 'DELETE_TORRENT') return `${count} torrent${count === 1 ? '' : 's'}`;
  if (record.operation === 'REMOVE_QUEUE') return `${count} queue item${count === 1 ? '' : 's'}`;
  return `${count} file${count === 1 ? '' : 's'}`;
}

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
        <h1 className="text-2xl font-semibold">Operation audit</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          File edits/imports and destructive media, torrent, and queue operations.
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
                    <Badge variant={OP_VARIANT[r.operation]} className="text-[10px]">{OP_LABEL[r.operation]}</Badge>
                    {!r.success && <Badge variant="destructive" className="text-[10px]">Failed</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {serviceLabel(r.service)}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
                </div>
                <p className="mt-1.5 break-words text-sm font-medium leading-snug">{r.mediaTitle}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {countLabel(r)}
                  {fields?.length ? ` · ${fields.join(', ')}` : ''}
                  {totalBytes != null ? ` · ${formatBytes(totalBytes)}` : ''}
                  {r.filesDeleted === true ? ' · files/data deleted' : r.filesDeleted === false ? ' · files/data kept' : ''}
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
