'use client';

import { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, FolderSync, Loader2, Power, RotateCw, Server } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { JellyfinScheduledTask, JellyfinSystemInfo } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { fetchJellyfinTasks } from '@/lib/widgets/widget-fetchers';
import { SectionHeader, HPR } from './bento-primitives';
import { useElementSize } from '@/lib/widgets/use-element-size';

type ServerAction = 'restart' | 'shutdown' | 'scan-libraries';

const SERVER_ACTION_LABELS: Record<ServerAction, string> = {
  restart: 'restart the Jellyfin server',
  shutdown: 'shut down the Jellyfin server',
  'scan-libraries': 'scan all libraries',
};

async function fetchSystem(signal?: AbortSignal): Promise<JellyfinSystemInfo | null> {
  const response = await fetch('/api/jellyfin/system', { signal });
  if (!response.ok) return null;
  const data = await response.json();
  return data.system ?? null;
}

export function JellyfinServerWidget({ refreshInterval, editMode = false }: WidgetProps) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const compactView = useMemo(() => width > 0 && width < 300, [width]);
  const { data: system, loading, refresh: refreshSystem } = useWidgetData({
    fetchFn: fetchSystem,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'jellyfin-system',
  });
  const { data: tasks, refresh: refreshTasks } = useWidgetData<JellyfinScheduledTask[]>({
    fetchFn: fetchJellyfinTasks,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'jellyfin-tasks',
    staleTime: refreshInterval,
  });

  const scanRunning = useMemo(
    () => (tasks ?? []).some((task) => task.Key === 'RefreshLibrary' && task.State === 'Running'),
    [tasks],
  );
  const refresh = useCallback(async () => {
    await Promise.all([refreshSystem(), refreshTasks()]);
  }, [refreshSystem, refreshTasks]);

  const [serverAction, setServerAction] = useState<ServerAction | null>(null);
  const [pendingServerAction, setPendingServerAction] = useState<ServerAction | null>(null);

  const runServerAction = useCallback(async (action: ServerAction) => {
    const label = SERVER_ACTION_LABELS[action];
    setServerAction(action);
    try {
      const res = await fetch('/api/jellyfin/system/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error || `Failed to ${label}`);
        return;
      }
      if (action === 'scan-libraries') {
        await refresh();
      }
    } catch {
      toast.error(`Failed to ${label}`);
    } finally {
      setServerAction(null);
    }
  }, [refresh]);

  const handleServerAction = useCallback(
    (action: ServerAction) => {
      if (editMode) return;
      if (action === 'scan-libraries') {
        void runServerAction(action);
        return;
      }
      setPendingServerAction(action);
    },
    [editMode, runServerAction],
  );

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SectionHeader title="Jellyfin Server" />
      {loading && !system ? (
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      ) : !system ? (
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
          Jellyfin server unreachable.
        </div>
      ) : (
        <div className="rounded-xl bg-card overflow-hidden">
          <div className="p-3 flex items-center gap-3">
            <div className="rounded-lg bg-[var(--hpr-cyan)]/10 p-2">
              <Server className="h-4 w-4 text-[var(--hpr-cyan)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{system.ServerName}</p>
              <p className="text-xs text-muted-foreground">v{system.Version}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap justify-end">
              {system.HasPendingRestart && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-500 border-amber-500/30">
                  Restart needed
                </Badge>
              )}
              {system.HasUpdateAvailable && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-blue-500 border-blue-500/30">
                  Update available
                </Badge>
              )}
              {!system.HasPendingRestart && !system.HasUpdateAvailable && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-green-500 border-green-500/30">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                  Healthy
                </Badge>
              )}
            </div>
          </div>
          <div className="border-t border-border/50 px-3 py-2 flex gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 flex-1 text-[11px] gap-1.5 text-muted-foreground hover:text-[var(--hpr-cyan)] hover:bg-[var(--hpr-cyan)]/10"
              disabled={editMode || serverAction !== null || tasks === null || scanRunning}
              onClick={() => handleServerAction('scan-libraries')}
            >
              {serverAction === 'scan-libraries' || scanRunning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <FolderSync className="h-3 w-3" />
              )}
              {compactView ? '' : scanRunning ? 'Scanning…' : 'Scan Libraries'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 flex-1 text-[11px] gap-1.5 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
              disabled={editMode || serverAction !== null}
              onClick={() => handleServerAction('restart')}
            >
              {serverAction === 'restart' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
              {compactView ? '' : 'Restart'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 flex-1 text-[11px] gap-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
              disabled={editMode || serverAction !== null}
              onClick={() => handleServerAction('shutdown')}
            >
              {serverAction === 'shutdown' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
              {compactView ? '' : 'Shutdown'}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingServerAction !== null}
        onOpenChange={(open) => {
          if (!open && serverAction === null) setPendingServerAction(null);
        }}
        title="Confirm action"
        description={
          pendingServerAction ? `Are you sure you want to ${SERVER_ACTION_LABELS[pendingServerAction]}?` : undefined
        }
        confirmLabel={
          pendingServerAction === 'shutdown'
            ? 'Shut down'
            : pendingServerAction === 'restart'
              ? 'Restart'
              : 'Confirm'
        }
        destructive
        busy={serverAction !== null}
        onConfirm={async () => {
          if (!pendingServerAction) return;
          await runServerAction(pendingServerAction);
          setPendingServerAction(null);
        }}
      />
    </div>
  );
}
