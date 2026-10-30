'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronRight, Loader2, Twitch } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/query-fetch';

interface StoredConnection {
  type: string;
  externalUrl: string | null;
  apiKey: string;
}

const QUERY_KEY = ['services', 'twitch-connection'];

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Twitch request failed');
  return data as { success?: boolean; error?: string };
}

export function TwitchConnectionCard() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<{ clientId: string; clientSecret: string } | null>(null);

  const connectionQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/services', { signal });
      if (!res.ok) throw new ApiError(res.status, 'Failed to load Twitch connection');
      const rows = (await res.json()) as StoredConnection[];
      return rows.find((row) => row.type === 'TWITCH') ?? null;
    },
  });
  const connection = connectionQuery.data ?? null;
  const clientId = draft?.clientId ?? connection?.externalUrl ?? '';
  const clientSecret = draft?.clientSecret ?? connection?.apiKey ?? '';
  const edit = (patch: Partial<{ clientId: string; clientSecret: string }>) =>
    setDraft({ clientId, clientSecret, ...patch });
  const reportError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) return;
    toast.error(err instanceof Error ? err.message : 'Twitch request failed');
  };

  const saveMutation = useMutation({
    mutationFn: () => postJson('/api/services/twitch', { clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
    onSuccess: () => {
      setDraft(null);
      toast.success('Connected to Twitch', { icon: <Check className="h-4 w-4 text-green-500" /> });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: reportError,
  });

  const testMutation = useMutation({
    mutationFn: () => postJson('/api/services/twitch/test', draft ?? undefined),
    onSuccess: (data) => {
      if (data.success) toast.success('Twitch accepted the credentials');
      else toast.error(data.error || 'Twitch test failed', { icon: <AlertTriangle className="h-4 w-4 text-red-500" /> });
    },
    onError: reportError,
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/services/twitch', { method: 'DELETE' });
      if (!res.ok) throw new ApiError(res.status, 'Failed to disconnect');
    },
    onSuccess: () => {
      setDraft(null);
      toast.success('Twitch disconnected');
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: reportError,
  });

  const busy = saveMutation.isPending || testMutation.isPending || disconnectMutation.isPending;
  const canSubmit = Boolean(clientId.trim() && clientSecret.trim()) && !busy;

  return (
    <div className="grouped-section mb-6">
      <div className="grouped-section-title">Twitch</div>
      <div className="grouped-section-content">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="grouped-row w-full active:bg-foreground/5 transition-colors"
          style={!expanded ? { borderBottom: 'none' } : undefined}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex w-7 h-7 items-center justify-center rounded-full bg-violet-500/15 text-violet-400">
              <Twitch className="h-4 w-4" />
            </span>
            <span className="text-sm font-medium truncate">Twitch</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${connection ? 'text-emerald-400' : 'text-muted-foreground'}`}>
              {connectionQuery.isLoading ? 'Loading…' : connection ? 'Connected' : 'Not connected'}
            </span>
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </div>
        </button>

        {expanded && (
          <div className="px-4 pb-4 pt-2 space-y-3 border-b border-foreground/[0.06] last:border-b-0">
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                1. Register a Confidential application at{' '}
                <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                  dev.twitch.tv/console/apps
                </a>{' '}
                with the redirect URL <span className="font-mono text-foreground">http://localhost</span>.
              </p>
              <p>2. Copy its Client ID and create a New Secret.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="twitch-client-id" className="text-xs text-muted-foreground">Client ID</Label>
              <Input
                id="twitch-client-id"
                value={clientId}
                autoComplete="off"
                onChange={(e) => edit({ clientId: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="twitch-client-secret" className="text-xs text-muted-foreground">Client Secret</Label>
              <Input
                id="twitch-client-secret"
                type="password"
                value={clientSecret}
                autoComplete="off"
                onChange={(e) => edit({ clientSecret: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={!canSubmit} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
              <Button variant="outline" className="flex-1" disabled={busy || (!connection && !canSubmit)} onClick={() => testMutation.mutate()}>
                {testMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Test
              </Button>
            </div>
            {connection && (
              <Button variant="outline" className="w-full" disabled={busy} onClick={() => disconnectMutation.mutate()}>
                Disconnect
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
