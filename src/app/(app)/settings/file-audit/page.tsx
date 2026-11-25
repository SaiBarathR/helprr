'use client';

import Link from '@/components/ui/app-link';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { Badge } from '@/components/ui/badge';
import { formatBytes } from '@/lib/format';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { WrappingPath } from '@/components/media/folder-name-row';
import { SecurityAuditList } from './security-audit-list';
import { OP_LABEL, OP_VARIANT, countLabel, moveMediaPaths } from './operation-labels';
import type { FileOperation } from '@prisma/client';

interface AuditRecord {
  id: string;
  username: string;
  service: 'SONARR' | 'RADARR' | 'LIDARR' | 'QBITTORRENT';
  instanceId: string | null;
  operation: FileOperation;
  mediaType: string;
  mediaId: number | null;
  mediaTitle: string;
  fileCount: number;
  filesDeleted: boolean | null;
  details: Record<string, unknown> | null;
  success: boolean;
  errorMessage: string | null;
  requestId: string | null;
  createdAt: string;
}

function serviceLabel(service: AuditRecord['service']): string {
  if (service === 'QBITTORRENT') return 'qBittorrent';
  return service[0] + service.slice(1).toLowerCase();
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNow(d, { addSuffix: true });
}

type AuditTab = 'operations' | 'security';

export default function FileAuditPage() {
  const [tab, setTab] = useRouteViewState<AuditTab>('FileAuditPage:tab', 'operations');

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
          {tab === 'security'
            ? 'Sign-ins, and changes to accounts, permissions, sessions, connections, server settings and settings imports. Names what changed, never the values. Records are kept for 365 days.'
            : 'File edits/imports and destructive media, torrent, and queue operations. Records are kept for 365 days.'}
        </p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as AuditTab)} className="gap-0">
        <div className="mb-3 px-4">
          <TabsList aria-label="Audit logs" variant="segmented">
            <TabsTrigger value="operations">Operations</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="operations"><OperationsList /></TabsContent>
        <TabsContent value="security"><SecurityAuditList /></TabsContent>
      </Tabs>
    </div>
  );
}

function OperationsList() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['file-audit'],
    queryFn: jsonFetcher<{ records: AuditRecord[]; total: number }>('/api/file-audit'),
  });
  const records = data?.records ?? [];

  return (
    <>
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
            // A bulk blocklist removal names each release (one is already the row's title).
            const titles = Array.isArray(r.details?.titles) && r.details.titles.length > 1 ? (r.details.titles as string[]) : null;
            const totalBytes = typeof r.details?.totalBytes === 'number' ? (r.details!.totalBytes as number) : null;
            const fields = Array.isArray(r.details?.fields) ? (r.details!.fields as string[]) : null;
            const move = moveMediaPaths(r);
            return (
              <div key={r.id} className="rounded-xl border bg-muted/30 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  {/* Wraps, so a long badge and the service never push the time out of the card at 320 px. */}
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge variant={OP_VARIANT[r.operation]} className="text-[10px]">{move?.label ?? OP_LABEL[r.operation]}</Badge>
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
                  {/* The choice made; a failed operation may not have deleted anything. */}
                  {r.filesDeleted === true ? (r.success ? ' · files/data deleted' : ' · files/data were to be deleted') : r.filesDeleted === false ? ' · files/data kept' : ''}
                  {move
                    // The *arr accepts the change and queues the move; success is not the move finishing.
                    ? r.details?.moveFiles === true
                      ? (r.success ? ' · file move queued' : ' · files were to be moved')
                      : ' · files not moved'
                    : ''}
                  {' · by '}{r.username}
                </p>
                {move && (
                  <p className="mt-1 break-words text-[11px] font-mono text-muted-foreground/80">
                    {move.from && <><WrappingPath path={move.from} />{' → '}</>}
                    {!move.from && '→ '}<WrappingPath path={move.to} />
                  </p>
                )}
                {titles && (
                  <p className="mt-1 break-words text-[11px] text-muted-foreground/80">
                    {titles.slice(0, 3).join(' • ')}{titles.length > 3 ? ` • +${titles.length - 3} more` : ''}
                  </p>
                )}
                {paths?.length ? (
                  <p className="mt-1 break-all text-[11px] font-mono text-muted-foreground/80">
                    {paths.slice(0, 3).join(' • ')}{paths.length > 3 ? ` • +${paths.length - 3} more` : ''}
                  </p>
                ) : null}
                {!r.success && r.errorMessage && (
                  <p className="mt-1 text-xs text-destructive">{r.errorMessage}</p>
                )}
                {r.requestId && (
                  <p className="mt-1 break-all text-[11px] font-mono text-muted-foreground/80">request {r.requestId}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
