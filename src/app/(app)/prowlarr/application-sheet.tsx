'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import type { ProwlarrApplicationSummary } from '@/lib/prowlarr-applications';
import type { ProwlarrApplicationBulkEdit, ProwlarrSyncLevel } from '@/lib/prowlarr-client';
import { prowlarrTagsQuery } from './prowlarr-tags-query';

export const SYNC_LEVELS: Record<string, string> = {
  disabled: 'Sync off',
  addOnly: 'Add and remove only',
  fullSync: 'Full sync',
};

const SYNC_LEVEL_HELP: Record<ProwlarrSyncLevel, (name: string) => string> = {
  disabled: (name) => `Prowlarr leaves ${name}’s indexers alone.`,
  addOnly: (name) => `Prowlarr adds an indexer to ${name} when you add it, and removes it when you delete it. Changes made in ${name} are kept.`,
  fullSync: (name) => `Prowlarr keeps ${name}’s indexers the same as its own.`,
};

/** Saved through the bulk editor, which changes only what is sent. */
async function saveApplication(edit: ProwlarrApplicationBulkEdit): Promise<string | null> {
  try {
    const res = await fetch('/api/prowlarr/applications/bulk', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit),
    });
    if (res.ok) return null;
    if (res.status === 404) return 'That app no longer exists';
    const data = await res.json().catch(() => ({}));
    return typeof data.error === 'string' ? data.error : 'Could not save';
  } catch {
    return 'Could not save';
  }
}

/**
 * One app's sync level and tags, each saved as it is picked, and Test and Sync
 * now. Full Sync can take indexers out of the arr, so choosing it asks first,
 * and the sheet says so whenever it is on.
 */
export function ApplicationSheet({ application, onClose }: {
  application: ProwlarrApplicationSummary | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const open = !!application;
  const tagsQuery = useQuery({ ...prowlarrTagsQuery, enabled: open });
  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmFullSync, setConfirmFullSync] = useState(false);
  const tags = tagsQuery.data ?? [];

  // `turnedOn`: Prowlarr's bulk editor syncs nothing, so an app whose sync was
  // just turned on gets its indexers only at the next sync; the toast says so.
  async function edit(change: Omit<ProwlarrApplicationBulkEdit, 'ids'>, failure: string, turnedOn = false) {
    if (!application) return;
    setPending(true);
    const error = await saveApplication({ ids: [application.id], ...change });
    if (error) toast.error(failure, { description: error });
    else if (turnedOn) toast.success(`Sync is on for ${application.name}`, { description: 'Use Sync now to send it the indexers now.' });
    await queryClient.invalidateQueries({ queryKey: ['prowlarr', 'applications'] });
    setPending(false);
  }

  function pickSyncLevel(syncLevel: ProwlarrSyncLevel) {
    if (!application || syncLevel === application.syncLevel) return;
    if (syncLevel === 'fullSync') {
      setConfirmFullSync(true);
      return;
    }
    void edit({ syncLevel }, `Could not change how ${application.name} syncs`, application.syncLevel === 'disabled');
  }

  async function post(path: 'test' | 'sync', done: string, failed: string, setBusy: (busy: boolean) => void) {
    if (!application) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/prowlarr/applications/${application.id}/${path}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      // Only a 409 (sync is off) says something fixed and safe; other failures are Prowlarr's and stay generic.
      if (res.ok) toast.success(done);
      else toast.error(failed, res.status === 409 && typeof data.error === 'string' ? { description: data.error } : undefined);
    } catch {
      toast.error(failed);
    } finally {
      setBusy(false);
    }
  }

  const name = application?.name ?? '';
  const fullSync = application?.syncLevel === 'fullSync';

  return (
    <>
      <Drawer open={open} autoFocus onOpenChange={(next) => { if (!next) onClose(); }}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="text-base leading-snug [overflow-wrap:anywhere]">{name || 'App'}</DrawerTitle>
            <DrawerDescription>
              {application ? `${application.implementationName} · ${SYNC_LEVELS[application.syncLevel] ?? application.syncLevel}` : ''}
            </DrawerDescription>
          </DrawerHeader>
          {application && (
            <div className="px-4 pb-8 flex-1 min-h-0 overflow-y-auto space-y-4">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={testing} onClick={() => void post('test', `${name} test passed`, `${name} test failed`, setTesting)}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Test
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  disabled={syncing || application.syncLevel === 'disabled'}
                  onClick={() => void post('sync', `${name} sync started`, `${name} sync failed`, setSyncing)}
                >
                  {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Sync now
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Sync now adds missing indexers to {name}{fullSync ? ' and updates the rest' : ''}. It removes none; Sync All on the Apps tab does that.
              </p>

              <section aria-label="Sync level" className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Sync level</p>
                <div role="group" aria-label="Sync level" className="rounded-lg bg-muted/30 divide-y divide-border/40">
                  {(['disabled', 'addOnly', 'fullSync'] as const).map((level) => {
                    const selected = application.syncLevel === level;
                    return (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={selected}
                        disabled={pending}
                        onClick={() => pickSyncLevel(level)}
                        className="flex w-full items-start gap-3 px-3 py-2.5 text-left disabled:opacity-60"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                            selected ? 'border-primary' : 'border-muted-foreground/50',
                          )}
                        >
                          {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                        </span>
                        <span className="min-w-0">
                          <span className={cn('block text-sm', selected && 'font-medium')}>{SYNC_LEVELS[level]}</span>
                          <span className="block text-xs text-muted-foreground">{SYNC_LEVEL_HELP[level](name)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {fullSync && (
                  <p role="note" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" aria-hidden />
                    <span className="min-w-0">
                      Full sync overwrites changes made to these indexers in {name}, and removes indexers from {name} that Prowlarr no longer has or whose tags no longer match.
                    </span>
                  </p>
                )}
              </section>

              {tags.length > 0 && (
                <section aria-label="Tags" className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => {
                      const assigned = application.tags.includes(tag.id);
                      return (
                        <Button
                          key={tag.id}
                          variant={assigned ? 'default' : 'outline'}
                          size="sm"
                          className="h-8 px-2.5 text-xs"
                          aria-pressed={assigned}
                          disabled={pending}
                          // One tag at a time, so a tag added elsewhere in the meantime is kept.
                          onClick={() => void edit(
                            { tags: [tag.id], applyTags: assigned ? 'remove' : 'add' },
                            `Could not change the tags of ${name}`,
                          )}
                        >
                          {tag.label}
                        </Button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    With tags, only indexers that share one sync to {name}; with none, every indexer does.
                    {fullSync && ' Under full sync, indexers that stop matching are removed from it at the next Sync All.'}
                  </p>
                </section>
              )}
            </div>
          )}
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={confirmFullSync}
        onOpenChange={setConfirmFullSync}
        title={`Full sync ${name}?`}
        description={`Prowlarr will overwrite changes made to its indexers in ${name}, and remove indexers from ${name} that it no longer has or whose tags no longer match.`}
        confirmLabel="Use full sync"
        busy={pending}
        onConfirm={async () => {
          await edit({ syncLevel: 'fullSync' }, `Could not change how ${name} syncs`, application?.syncLevel === 'disabled');
          setConfirmFullSync(false);
        }}
      />
    </>
  );
}
