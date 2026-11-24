'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { jsonFetcher } from '@/lib/query-fetch';
import { PROWLARR_SYNC_LEVELS, type UnsyncedConnection } from '@/lib/prowlarr-applications';
import type { ProwlarrSyncLevel } from '@/lib/prowlarr-client';
import { SYNC_LEVELS } from './application-sheet';

interface Suggestion {
  implementation: string;
  name: string;
  baseUrl: string;
  prowlarrUrl: string;
}

/**
 * Add one of Helprr's arr connections to Prowlarr as an app. The server builds
 * the app from Prowlarr's own form and sends the arr's API key itself; this page
 * only ever sees the name, the two addresses and the sync level.
 */
export function AddApplicationSheet({ connection, onClose }: {
  connection: UnsyncedConnection | null;
  onClose: () => void;
}) {
  const open = !!connection;
  const suggestionQuery = useQuery({
    queryKey: ['prowlarr', 'app-suggestion', connection?.id],
    queryFn: jsonFetcher<Suggestion>(`/api/prowlarr/applications/from-connection?connectionId=${encodeURIComponent(connection?.id ?? '')}`),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });

  return (
    <Drawer open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-base leading-snug [overflow-wrap:anywhere]">
            Add {connection?.label ?? 'app'} to Prowlarr
          </DrawerTitle>
          <DrawerDescription>
            Helprr sends {connection?.label ?? 'the app'}’s address and API key to Prowlarr itself; the key never comes to this page.
          </DrawerDescription>
        </DrawerHeader>
        {connection && (suggestionQuery.data ? (
          // Keyed so a second connection starts from its own guesses.
          <AddApplicationForm key={connection.id} connection={connection} suggestion={suggestionQuery.data} onDone={onClose} />
        ) : (
          <div className="flex flex-1 min-h-0 items-center justify-center px-4 pb-8 text-sm text-muted-foreground">
            {suggestionQuery.isError ? 'Could not reach Prowlarr.' : <Loader2 className="h-6 w-6 animate-spin" />}
          </div>
        ))}
      </DrawerContent>
    </Drawer>
  );
}

function AddApplicationForm({ connection, suggestion, onDone }: {
  connection: UnsyncedConnection;
  suggestion: Suggestion;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(suggestion.name);
  const [baseUrl, setBaseUrl] = useState(suggestion.baseUrl);
  const [prowlarrUrl, setProwlarrUrl] = useState(suggestion.prowlarrUrl);
  const [syncLevel, setSyncLevel] = useState<ProwlarrSyncLevel>('fullSync');
  const [busy, setBusy] = useState<'test' | 'add' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const label = connection.label;

  async function submit(testOnly: boolean) {
    setBusy(testOnly ? 'test' : 'add');
    setResult(null);
    try {
      const res = await fetch('/api/prowlarr/applications/from-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connection.id, name, baseUrl, prowlarrUrl, syncLevel, testOnly }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, message: typeof data.error === 'string' ? data.error : 'Something went wrong' });
        return;
      }
      if (testOnly) {
        setResult({ ok: true, message: `Prowlarr reached ${label}, and ${label} reached Prowlarr.` });
        return;
      }
      toast.success(`${name} added to Prowlarr`);
      await queryClient.invalidateQueries({ queryKey: ['prowlarr', 'applications'] });
      onDone();
    } catch {
      setResult({ ok: false, message: 'Could not reach Helprr' });
    } finally {
      setBusy(null);
    }
  }

  const ready = name.trim() && baseUrl.trim() && prowlarrUrl.trim();

  return (
    <>
      <div className="px-4 pb-4 flex-1 min-h-0 overflow-y-auto space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="prowlarr-app-name">Name in Prowlarr</Label>
          <Input id="prowlarr-app-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prowlarr-app-base-url">Prowlarr reaches {label} at</Label>
          <Input
            id="prowlarr-app-base-url"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The address Helprr uses. If Prowlarr runs in Docker, it may need {label}’s container name instead, such as http://{suggestion.implementation.toLowerCase()}:port.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prowlarr-app-prowlarr-url">{label} reaches Prowlarr at</Label>
          <Input
            id="prowlarr-app-prowlarr-url"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={prowlarrUrl}
            onChange={(event) => setProwlarrUrl(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {label} fetches search results from this address. Filled in from Prowlarr’s other apps when it has some.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prowlarr-app-sync-level">Sync level</Label>
          <Select value={syncLevel} onValueChange={(value) => setSyncLevel(value as ProwlarrSyncLevel)}>
            <SelectTrigger id="prowlarr-app-sync-level" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROWLARR_SYNC_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>{SYNC_LEVELS[level]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {syncLevel === 'fullSync' && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" aria-hidden />
              <span className="min-w-0">
                Prowlarr’s default. It overwrites changes made in {label} to the indexers it syncs, and removes ones Prowlarr no longer has.
              </span>
            </p>
          )}
        </div>
        {result && (
          <p
            role={result.ok ? 'status' : 'alert'}
            className={`rounded-lg border px-3 py-2 text-xs [overflow-wrap:anywhere] ${result.ok
              ? 'border-green-500/30 bg-green-500/10'
              : 'border-rose-500/30 bg-rose-500/10'}`}
          >
            {result.message}
          </p>
        )}
      </div>
      <DrawerFooter className="border-t">
        <div className="grid grid-cols-2 gap-2 w-full">
          <Button variant="outline" disabled={!ready || busy !== null} onClick={() => void submit(true)} className="gap-1.5">
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Test
          </Button>
          <Button disabled={!ready || busy !== null} onClick={() => void submit(false)} className="gap-1.5">
            {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </Button>
        </div>
      </DrawerFooter>
    </>
  );
}
