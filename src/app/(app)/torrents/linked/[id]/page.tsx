'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, ListChecks, Loader2, RefreshCw, RotateCcw, Unlink, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCan } from '@/components/permission-provider';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { formatBytes, formatDistanceToNowShort } from '@/lib/format';
import {
  appName,
  isOpen,
  nextStep,
  PIPELINE,
  pipelineStep,
  StatusBadge,
  statusTone,
  titleHref,
  STATUS_LABEL,
  type ManualDownloadView,
} from '@/components/torrents/manual-download-status';
import { CancelManualDownloadDialog, type CancelChoices } from '@/components/torrents/cancel-manual-download-dialog';

const SENDING = ['PREFLIGHT', 'CREATING_MEDIA', 'SUBMITTING_RELEASE'];

async function sendJson(path: string, method: 'POST' | 'DELETE', body?: unknown): Promise<{ message?: string }> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null) as { error?: string; message?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Something went wrong');
  return data ?? {};
}

/** One release sent to Sonarr/Radarr: where it stands, what happened, and what can be done. */
export default function LinkedDownloadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = useCan('activity.manage');
  const canAdd = useCan('torrents.add');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.manualDownload(id),
    queryFn: jsonFetcher<{ download: ManualDownloadView }>(`/api/manual-downloads/${id}`),
    refetchInterval: (current) => (current.state.data && !isOpen(current.state.data.download) ? false : 10_000),
  });
  const download = query.data?.download;

  const onActionError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) return;
    toast.error(error instanceof Error ? error.message : 'Something went wrong');
  };
  const cancel = useMutation({
    mutationFn: (choices: CancelChoices) => sendJson(`/api/manual-downloads/${id}/cancel`, 'POST', choices),
    onSuccess: (data) => {
      setCancelOpen(false);
      toast.success(data.message ?? 'Cancelled');
      void queryClient.invalidateQueries({ queryKey: ['manual-downloads'] });
    },
    onError: onActionError,
  });
  const rescan = useMutation({
    mutationFn: () => sendJson(`/api/manual-downloads/${id}/rescan`, 'POST'),
    onSuccess: () => {
      toast.success('Scanned again');
      void queryClient.invalidateQueries({ queryKey: ['manual-downloads'] });
    },
    onError: onActionError,
  });
  const unlink = useMutation({
    mutationFn: () => sendJson(`/api/manual-downloads/${id}`, 'DELETE'),
    onSuccess: () => {
      toast.success('Unlinked');
      void queryClient.invalidateQueries({ queryKey: ['manual-downloads'] });
      router.replace('/torrents/linked');
    },
    onError: onActionError,
  });

  if (query.isPending) {
    return (
      <div className="animate-content-in">
        <PageHeader title="Linked download" />
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      </div>
    );
  }
  if (!download) {
    return (
      <div className="animate-content-in">
        <PageHeader title="Linked download" />
        <p className="py-12 text-center text-sm text-muted-foreground">
          {query.error instanceof ApiError && query.error.status === 404 ? 'This linked download no longer exists.' : 'It could not be loaded.'}
        </p>
      </div>
    );
  }

  const app = appName(download);
  const events = download.events ?? [];
  const sending = SENDING.includes(download.status);
  const reached = Math.max(-1, ...events.map((event) => pipelineStep(event.status)), pipelineStep(download.status));
  const troubled = statusTone(download.status) === 'attention';
  const href = titleHref(download);
  const fallback = download.mode === 'QBIT_REVIEWED';
  const waitingOnUser = fallback && (download.status === 'NEEDS_MAPPING' || download.status === 'BLOCKED');
  const chosenFiles = (download.files ?? []).filter((file) => file.selected);
  const scanned = chosenFiles.some((file) => file.scanned);
  const resendHref = `/torrents/add?${new URLSearchParams({
    linkService: download.service,
    ...(download.instanceId ? { linkInstance: download.instanceId } : {}),
    linkExternalId: String(download.externalId),
    linkTitle: download.arrItemTitle,
    linkRelease: download.releaseTitle,
  })}`;

  return (
    <div className="animate-content-in">
      <PageHeader title={download.arrItemTitle} subtitle={`${app} · ${download.instanceLabel}`} />

      <div className="mt-1 space-y-4 pb-8">
        <section className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <StatusBadge status={download.status} />
            <span className="text-xs text-muted-foreground">{formatDistanceToNowShort(download.updatedAt)}</span>
          </div>
          <p className="text-sm">{nextStep(download)}</p>
          {download.lastError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="tracked-caps text-[10px] text-destructive">{download.status === 'NEEDS_MAPPING' ? 'What to confirm' : 'What went wrong'}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{download.lastError}</p>
            </div>
          )}

          <ol className="grid grid-cols-4 gap-1 pt-1" aria-label="Progress">
            {PIPELINE.map((step, index) => {
              const done = index <= reached;
              const stuck = troubled && index === reached + 1;
              return (
                <li key={step} className="space-y-1.5">
                  <div className={`h-1 rounded-full ${done ? 'bg-primary' : stuck ? 'bg-destructive' : 'bg-muted'}`} />
                  <div className={`flex items-center gap-1 text-[11px] ${done ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {done && <Check className="h-3 w-3 shrink-0" />}
                    {stuck && <X className="h-3 w-3 shrink-0 text-destructive" />}
                    <span className="truncate">{step}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="flex flex-wrap gap-2">
          {href && (
            <Button variant="outline" size="sm" onClick={() => router.push(href)}>
              <ExternalLink className="mr-1.5 h-4 w-4" />
              Open {download.service === 'RADARR' ? 'movie' : 'series'}
            </Button>
          )}
          {canManage && waitingOnUser && scanned && (
            <Button size="sm" onClick={() => router.push(`/torrents/linked/${download.id}/map`)}>
              <ListChecks className="mr-1.5 h-4 w-4" />
              Map files
            </Button>
          )}
          {canManage && waitingOnUser && (
            <Button variant="outline" size="sm" onClick={() => rescan.mutate()} disabled={rescan.isPending}>
              {rescan.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              Scan again
            </Button>
          )}
          {canAdd && !isOpen(download) && download.status !== 'IMPORTED' && (
            <Button variant="outline" size="sm" onClick={() => router.push(resendHref)}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Send again
            </Button>
          )}
          {canManage && isOpen(download) && !sending && (
            <Button variant="outline" size="sm" className="text-destructive" onClick={() => setCancelOpen(true)}>
              <X className="mr-1.5 h-4 w-4" />
              Cancel download
            </Button>
          )}
          {canManage && !sending && (
            <Button variant="ghost" size="sm" onClick={() => setUnlinkOpen(true)}>
              <Unlink className="mr-1.5 h-4 w-4" />
              Unlink
            </Button>
          )}
        </div>

        <section className="rounded-xl border bg-card">
          <dl className="divide-y divide-border text-sm">
            <Row label="Release"><span className="break-all">{download.releaseTitle}</span></Row>
            <Row label="Source">{download.source === 'MAGNET' ? 'Magnet link' : '.torrent file'}</Row>
            <Row label="Info hash"><span className="break-all font-mono text-xs">{download.infoHash}</span></Row>
            <Row label="Download client">{download.downloadClientName ?? `Chosen by ${app}`}</Row>
            <Row label={download.service === 'RADARR' ? 'Movie' : 'Series'}>
              {download.arrItemTitle}
              <span className="block text-xs text-muted-foreground">
                {download.createdArrItem ? 'Added to the library by this download' : 'Already in the library'}
                {download.service === 'SONARR' && download.targetEpisodeIds.length > 0 && ` · ${download.targetEpisodeIds.length} episode${download.targetEpisodeIds.length === 1 ? '' : 's'}`}
              </span>
            </Row>
            <Row label="Sent by">{download.createdByUsername} · {formatDistanceToNowShort(download.createdAt)}</Row>
            {download.completedAt && <Row label="Finished">{formatDistanceToNowShort(download.completedAt)}</Row>}
          </dl>
        </section>

        {fallback && chosenFiles.length > 0 && (
          <section className="space-y-2">
            <h2 className="tracked-caps text-[11px] text-muted-foreground">
              Files: {chosenFiles.length} of {download.files!.length} chosen
            </h2>
            <ul className="divide-y divide-border rounded-xl border bg-card">
              {chosenFiles.map((file) => (
                <li key={file.id} className="space-y-0.5 px-4 py-2.5">
                  <p className="break-all text-sm">{file.path.split(/[\\/]/).pop()}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                    {file.decision === 'IMPORT' ? ' · Imported as decided' : file.decision === 'IGNORE' ? ' · Left out' : ''}
                    {file.arr ? ` · ${app} reads: ${[file.arr.movie?.title ?? file.arr.series?.title, file.arr.episodes.map((episode) => `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`).join(', '), file.arr.quality].filter(Boolean).join(' · ') || 'nothing'}` : ''}
                  </p>
                  {file.arr && file.arr.rejections.length > 0 && <p className="text-xs text-amber-500">{file.arr.rejections.join('; ')}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="tracked-caps text-[11px] text-muted-foreground">History</h2>
          <ol className="space-y-3 rounded-xl border bg-card p-4">
            {[...events].reverse().map((event, index) => (
              <li key={`${event.at}-${index}`} className="space-y-0.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium">{STATUS_LABEL[event.status]}</span>
                  <span className="text-muted-foreground">{formatDistanceToNowShort(event.at)}</span>
                </div>
                {event.message && <p className="break-words text-xs text-muted-foreground">{event.message}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <CancelManualDownloadDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        download={download}
        busy={cancel.isPending}
        onConfirm={(choices) => cancel.mutate(choices)}
      />
      <ConfirmDialog
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        title="Unlink this download?"
        description={`Helprr forgets it and its history. ${app}, the download client and the library are not changed${isOpen(download) ? `, and ${app} carries on with the download` : ''}.`}
        confirmLabel="Unlink"
        busy={unlink.isPending}
        onConfirm={() => unlink.mutate()}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-4 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
