'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCan, useMe } from '@/components/permission-provider';
import { jsonFetcher } from '@/lib/query-fetch';
import { isProwlarrTestAllResponse } from '@/lib/prowlarr-client';
import type { ProwlarrApplicationSummary, UnsyncedConnection } from '@/lib/prowlarr-applications';
import { prowlarrTagsQuery } from './prowlarr-tags-query';
import { ApplicationSheet, SYNC_LEVELS } from './application-sheet';
import { AddApplicationSheet } from './add-application-sheet';
import { refreshProwlarrHealth } from './use-indexer-actions';

/**
 * Whether Prowlarr is syncing indexers to each arr. If a sync breaks, indexers
 * silently stop reaching Sonarr or Radarr, and only Helprr knows about an arr it
 * is connected to that Prowlarr has no app for.
 */
export function ApplicationsTab() {
  const queryClient = useQueryClient();
  const canManage = useCan('prowlarr.manage');
  // Adding an app hands an arr's API key to Prowlarr, which the route keeps to admins.
  const isAdmin = useMe()?.role === 'admin';
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [adding, setAdding] = useState<UnsyncedConnection | null>(null);
  const [syncAllOpen, setSyncAllOpen] = useState(false);
  const query = useQuery({
    queryKey: ['prowlarr', 'applications'],
    queryFn: jsonFetcher<{ applications: ProwlarrApplicationSummary[]; unsynced: UnsyncedConnection[] }>('/api/prowlarr/applications'),
    staleTime: 60_000,
  });
  const tagsQuery = useQuery(prowlarrTagsQuery);

  async function test(application: ProwlarrApplicationSummary) {
    setTestingId(application.id);
    try {
      const res = await fetch(`/api/prowlarr/applications/${application.id}/test`, { method: 'POST' });
      if (res.ok) toast.success(`${application.name} test passed`);
      else toast.error(`${application.name} test failed`);
    } catch {
      toast.error(`${application.name} test failed`);
    } finally {
      setTestingId(null);
    }
  }

  async function testAll() {
    setTestingAll(true);
    try {
      const res = await fetch('/api/prowlarr/applications/testall', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !isProwlarrTestAllResponse(data)) {
        toast.error('Test All failed');
      } else if (data.results.length === 0) {
        toast.info('No enabled apps to test');
      } else if (data.hasFailures) {
        const names = new Map(query.data?.applications.map((application) => [application.id, application.name]));
        const failed = data.results.filter((result) => !result.isValid).map((result) => names.get(result.id) ?? `App ${result.id}`);
        toast.error(`${data.passed} passed, ${data.failed} failed`, { description: failed.join(', ') });
      } else {
        toast.success('All apps passed');
      }
    } catch {
      toast.error('Test All failed');
    } finally {
      setTestingAll(false);
    }
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (query.isError) {
    return <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">Failed to load apps</div>;
  }

  const applications = query.data?.applications ?? [];
  const unsynced = query.data?.unsynced ?? [];
  const tagLabels = new Map((tagsQuery.data ?? []).map((tag) => [tag.id, tag.label]));
  // Looked up by id, so the sheet shows each save as soon as the list refetches.
  const sheetApplication = applications.find((application) => application.id === sheetId) ?? null;

  return (
    <div className="space-y-3">
      {unsynced.length > 0 && (
        <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 space-y-1.5">
          {unsynced.map((connection) => (
            <div key={connection.id} className="flex items-start gap-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" aria-label="Warning" />
              <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {connection.label} may not be synced: no Prowlarr app seems to point at it. If Prowlarr reaches it by another address, ignore this.
              </p>
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  className="-my-1 h-8 shrink-0 gap-1 px-2 text-xs"
                  aria-label={`Add ${connection.label} to Prowlarr`}
                  onClick={() => setAdding(connection)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && applications.length > 0 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={testAll} disabled={testingAll}>
            {testingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Test All
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setSyncAllOpen(true)}>
            <RefreshCw className="h-4 w-4" />
            Sync All
          </Button>
        </div>
      )}

      {applications.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">No apps set up in Prowlarr.</div>
      ) : (
        <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50">
          {applications.map((application) => (
            <div key={application.id} className="relative flex items-center gap-3 px-4 py-3">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${application.enable && application.syncLevel !== 'disabled' ? 'bg-green-500' : 'bg-amber-500'}`}
                title={application.enable ? 'Enabled' : 'Disabled'}
              />
              <div className="min-w-0 flex-1">
                {canManage ? (
                  // Stretched over the row; the row's Test button sits above it.
                  <button
                    type="button"
                    onClick={() => setSheetId(application.id)}
                    className="block max-w-full truncate text-left text-sm font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                  >
                    {application.name}
                  </button>
                ) : (
                  <p className="text-sm font-medium truncate">{application.name}</p>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{application.implementationName}</Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {SYNC_LEVELS[application.syncLevel] ?? application.syncLevel}
                  </span>
                  {application.tags.filter((id) => tagLabels.has(id)).map((id) => (
                    <Badge key={id} variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">{tagLabels.get(id)}</Badge>
                  ))}
                </div>
              </div>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="relative z-10 h-8 px-2 text-xs shrink-0"
                  aria-label={`Test ${application.name}`}
                  onClick={() => void test(application)}
                  disabled={testingId === application.id}
                >
                  {testingId === application.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && <ApplicationSheet application={sheetApplication} onClose={() => setSheetId(null)} />}
      {isAdmin && <AddApplicationSheet connection={adding} onClose={() => setAdding(null)} />}
      {canManage && (
        <SyncAllDialog
          open={syncAllOpen}
          onOpenChange={setSyncAllOpen}
          fullSyncNames={applications.filter((application) => application.syncLevel === 'fullSync').map((application) => application.name)}
          onSynced={() => refreshProwlarrHealth(queryClient)}
        />
      )}
    </div>
  );
}

/**
 * Prowlarr's own sync of every app, as its Sync App Indexers button runs it:
 * unlike one app's Sync now, it also removes indexers. Forcing it re-sends
 * every indexer even when Prowlarr thinks the arr already has it as is.
 */
function SyncAllDialog({ open, onOpenChange, fullSyncNames, onSynced }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fullSyncNames: string[];
  onSynced: () => void;
}) {
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    try {
      const res = await fetch('/api/prowlarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ApplicationIndexerSync', ...(force ? { forceSync: true } : {}) }),
      });
      if (res.ok) {
        toast.success(force ? 'Forced sync started' : 'Sync started');
        onSynced();
        onOpenChange(false);
        setForce(false);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(typeof data.error === 'string' ? data.error : 'Sync All failed');
      }
    } catch {
      toast.error('Sync All failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sync all apps?</DialogTitle>
          <DialogDescription>
            Prowlarr adds missing indexers to every app with sync on, and removes the ones it has deleted.
          </DialogDescription>
        </DialogHeader>
        {fullSyncNames.length > 0 && (
          <p role="note" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              Full sync: {fullSyncNames.join(', ')}. In these, Prowlarr also updates its indexers, overwriting changes made in the app, and removes indexers whose tags no longer match.
            </span>
          </p>
        )}
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={force} onCheckedChange={setForce} aria-label="Force" className="mt-0.5" />
          <span className="min-w-0">
            Force
            <span className="block text-xs text-muted-foreground">
              Re-send every indexer to the full sync apps, even ones Prowlarr thinks are up to date.
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={() => void sync()} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {force ? 'Force sync' : 'Sync'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
