'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  Loader2,
  Route,
  Unlink,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { jsonFetcher } from '@/lib/query-fetch';
import { useCan } from '@/components/permission-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type Attempt = {
  id: string;
  attempt: number;
  outcome: string;
  scanPath: string | null;
  commandId: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type Mapping = {
  id: string;
  torrentHash: string | null;
  torrentName: string;
  service: 'SONARR' | 'RADARR';
  arrItemId: number;
  arrTitle: string;
  status: string;
  arrDownloadId: string | null;
  arrQueueId: number | null;
  attemptCount: number;
  importCommandId: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  instance: { label: string; type: string };
  attempts: Attempt[];
};

const TERMINAL = new Set(['IMPORTED', 'CANCELLED']);
const BAD = new Set(['BLOCKED', 'IMPORT_BLOCKED', 'FAILED']);

function statusTone(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'IMPORTED') return 'default';
  if (BAD.has(status)) return 'destructive';
  if (status === 'IMPORTING' || status === 'READY_TO_IMPORT') return 'secondary';
  return 'outline';
}

function statusLabel(status: string) {
  return status
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function Pipeline({ status }: { status: string }) {
  const arrAccepted = !['PREFLIGHT', 'CREATING_MEDIA', 'SUBMITTING_RELEASE', 'FAILED'].includes(status);
  const downloadDone = ['IMPORT_PENDING', 'IMPORTING', 'IMPORTED'].includes(status);
  const imported = status === 'IMPORTED';
  const arrBad = BAD.has(status);
  return (
    <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      <span className={arrAccepted ? 'text-foreground' : undefined}>Arr</span>
      <span className={`h-px min-w-4 flex-1 ${arrAccepted ? 'bg-primary' : 'bg-border'}`} />
      <span className={arrBad ? 'text-destructive' : downloadDone ? 'text-foreground' : undefined}>Download</span>
      <span
        className={`h-px min-w-4 flex-1 ${
          imported ? 'bg-primary' : arrBad ? 'bg-destructive' : 'bg-border'
        }`}
      />
      <span className={imported ? 'text-foreground' : undefined}>Library</span>
    </div>
  );
}

export function ManualDownloadManager() {
  const queryClient = useQueryClient();
  const canManage = useCan('torrents.manage');
  const [scope, setScope] = useState<'open' | 'errors' | 'history'>('open');
  // Collapsed by default so the torrents list stays primary; auto-open once
  // when something needs attention so failures aren't buried.
  const [expanded, setExpanded] = useState(false);
  const [didAutoExpandErrors, setDidAutoExpandErrors] = useState(false);
  const [selected, setSelected] = useState<Mapping | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const mappingsQuery = useQuery({
    queryKey: ['manual-downloads'],
    queryFn: jsonFetcher<Mapping[]>('/api/manual-downloads'),
    refetchInterval: 15_000,
  });

  const mappings = useMemo(() => mappingsQuery.data ?? [], [mappingsQuery.data]);
  const openCount = mappings.filter((m) => !TERMINAL.has(m.status)).length;
  const errorCount = mappings.filter((m) => BAD.has(m.status)).length;
  const visible = mappings.filter((mapping) =>
    scope === 'errors'
      ? BAD.has(mapping.status)
      : scope === 'history'
        ? TERMINAL.has(mapping.status)
        : !TERMINAL.has(mapping.status),
  );

  useEffect(() => {
    if (didAutoExpandErrors || errorCount === 0) return;
    setDidAutoExpandErrors(true);
    setExpanded(true);
    setScope('errors');
  }, [didAutoExpandErrors, errorCount]);

  // Stay out of the way until there is something to show.
  if (mappingsQuery.isLoading || mappings.length === 0) return null;

  const summary =
    errorCount > 0
      ? `${errorCount} need attention`
      : openCount > 0
        ? `${openCount} active handoff${openCount === 1 ? '' : 's'}`
        : `${mappings.length} in history`;

  async function unlink(id: string) {
    setBusy('unlink');
    try {
      const res = await fetch(`/api/manual-downloads/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Action failed');
      toast.success('Tracking record removed');
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ['manual-downloads'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <Route className={`h-3.5 w-3.5 shrink-0 ${errorCount > 0 ? 'text-destructive' : 'text-primary'}`} />
        <span className="text-sm font-medium shrink-0">Mapped</span>
        <span className="text-xs text-muted-foreground truncate min-w-0">{summary}</span>
        {mappingsQuery.isFetching && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground ml-auto transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <>
          <div className="flex gap-1 px-2 pb-2">
            {(['open', 'errors', 'history'] as const).map((item) => (
              <Button
                key={item}
                size="sm"
                variant={scope === item ? 'secondary' : 'ghost'}
                className="h-7 text-xs capitalize"
                onClick={() => setScope(item)}
              >
                {item}
                {item === 'open' && openCount > 0 ? ` · ${openCount}` : ''}
                {item === 'errors' && errorCount > 0 ? ` · ${errorCount}` : ''}
              </Button>
            ))}
          </div>

          <div className="divide-y border-t max-h-48 overflow-y-auto">
            {visible.length === 0 && (
              <p className="px-3 py-2.5 text-xs text-muted-foreground">No {scope} mappings.</p>
            )}
            {visible.map((mapping) => (
              <button
                key={mapping.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                onClick={() => {
                  setSelected(mapping);
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{mapping.arrTitle}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {mapping.instance.label}
                    {mapping.lastError ? ` · ${mapping.lastError}` : ` · ${mapping.torrentName}`}
                  </p>
                </div>
                <Badge variant={statusTone(mapping.status)} className="text-[10px] shrink-0">
                  {statusLabel(mapping.status)}
                </Badge>
              </button>
            ))}
          </div>
        </>
      )}

      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DrawerContent className="max-h-[92dvh]">
          <div className="mx-auto w-full max-w-xl overflow-y-auto">
            {selected && (
              <>
                <DrawerHeader>
                  <DrawerTitle>{selected.arrTitle}</DrawerTitle>
                  <DrawerDescription>
                    {selected.service === 'SONARR' ? 'Sonarr' : 'Radarr'} · {selected.instance.label} · Item #
                    {selected.arrItemId}
                  </DrawerDescription>
                </DrawerHeader>
                <div className="px-4 space-y-4">
                  <div className="rounded-xl border p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={statusTone(selected.status)}>{statusLabel(selected.status)}</Badge>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {selected.torrentHash?.slice(0, 12) ?? 'pending'}
                      </span>
                    </div>
                    <Pipeline status={selected.status} />
                    <p className="text-xs text-muted-foreground break-all">{selected.torrentName}</p>
                    {selected.lastError && (
                      <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive whitespace-pre-wrap break-words">
                        <AlertTriangle className="h-4 w-4 mb-1" />
                        {selected.lastError}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-muted p-3">
                      <Clock3 className="h-4 w-4 mb-1" />
                      <span className="text-muted-foreground">Arr queue</span>
                      <p className="font-mono mt-1">{selected.arrQueueId ?? '—'}</p>
                    </div>
                    <div className="rounded-lg bg-muted p-3">
                      <CheckCircle2 className="h-4 w-4 mb-1" />
                      <span className="text-muted-foreground">Download ID</span>
                      <p className="font-mono mt-1 truncate">{selected.arrDownloadId ?? '—'}</p>
                    </div>
                  </div>
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-medium mb-2">
                      <History className="h-4 w-4" />
                      Attempt history
                    </h3>
                    <div className="space-y-2">
                      {selected.attempts.length === 0 && (
                        <p className="text-xs text-muted-foreground">No recorded attempts yet.</p>
                      )}
                      {selected.attempts.map((attempt) => (
                        <div key={attempt.id} className="rounded-lg border p-2 text-xs">
                          <div className="flex justify-between gap-2">
                            <span className="font-medium">Attempt {attempt.attempt}</span>
                            <Badge
                              variant={
                                attempt.outcome === 'IMPORTED'
                                  ? 'default'
                                  : attempt.outcome === 'BLOCKED'
                                    ? 'destructive'
                                    : 'outline'
                              }
                              className="text-[9px]"
                            >
                              {attempt.outcome}
                            </Badge>
                          </div>
                          {attempt.scanPath && (
                            <p className="font-mono text-[10px] text-muted-foreground mt-1 break-all">
                              {attempt.scanPath}
                            </p>
                          )}
                          {attempt.error && (
                            <p className="text-destructive mt-1 whitespace-pre-wrap break-words">
                              {attempt.error}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <DrawerFooter className="flex-row flex-wrap">
                  {canManage && (
                    <Button
                      variant="destructive"
                      className="flex-1"
                      onClick={() => setConfirmUnlink(true)}
                      disabled={Boolean(busy)}
                    >
                      <Unlink className="h-4 w-4 mr-1" />
                      Unlink
                    </Button>
                  )}
                </DrawerFooter>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={confirmUnlink}
        onOpenChange={setConfirmUnlink}
        title="Unlink this download?"
        description="This removes Helprr's mapping and attempt history. It does not delete the torrent or the Sonarr/Radarr item."
        confirmLabel="Unlink mapping"
        destructive
        busy={busy === 'unlink'}
        onConfirm={async () => {
          if (!selected) return;
          await unlink(selected.id);
          setConfirmUnlink(false);
        }}
      />
    </section>
  );
}
