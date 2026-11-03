'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronRight, Loader2, Youtube } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/query-fetch';

const QUERY_KEY = ['services', 'youtube-connection'];

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || 'YouTube request failed');
  return data as { success?: boolean; error?: string };
}

export function YoutubeConnectionCard({ defaultExpanded = false }: { defaultExpanded?: boolean }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [apiKey, setApiKey] = useState('');

  const connectionQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/services', { signal });
      if (!res.ok) throw new ApiError(res.status, 'Failed to load the YouTube connection');
      const rows = (await res.json()) as Array<{ type: string }>;
      return rows.some((row) => row.type === 'YOUTUBE');
    },
  });
  const connected = connectionQuery.data ?? false;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['youtube', 'setup'] });
  };
  const reportError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) return;
    toast.error(err instanceof Error ? err.message : 'YouTube request failed');
  };

  const saveMutation = useMutation({
    mutationFn: () => postJson('/api/services/youtube', { apiKey: apiKey.trim() }),
    onSuccess: () => {
      setApiKey('');
      toast.success('Connected to YouTube', { icon: <Check className="h-4 w-4 text-green-500" /> });
      refresh();
    },
    onError: reportError,
  });

  const testMutation = useMutation({
    mutationFn: () => postJson('/api/services/youtube/test', apiKey.trim() ? { apiKey: apiKey.trim() } : undefined),
    onSuccess: (data) => {
      if (data.success) toast.success('YouTube accepted the key');
      else toast.error(data.error || 'YouTube test failed', { icon: <AlertTriangle className="h-4 w-4 text-red-500" /> });
    },
    onError: reportError,
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/services/youtube', { method: 'DELETE' });
      if (!res.ok) throw new ApiError(res.status, 'Failed to disconnect');
    },
    onSuccess: () => {
      toast.success('YouTube disconnected');
      refresh();
    },
    onError: reportError,
  });

  const busy = saveMutation.isPending || testMutation.isPending || disconnectMutation.isPending;

  return (
    <div className="grouped-section mb-6">
      <div className="grouped-section-title">YouTube</div>
      <div className="grouped-section-content">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="grouped-row w-full active:bg-foreground/5 transition-colors"
          style={!expanded ? { borderBottom: 'none' } : undefined}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex w-7 h-7 items-center justify-center rounded-full bg-red-500/15 text-red-400 shrink-0">
              <Youtube className="h-4 w-4" />
            </span>
            <span className="text-sm font-medium truncate">YouTube</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${connected ? 'text-emerald-400' : 'text-muted-foreground'}`}>
              {connectionQuery.isLoading ? 'Loading…' : connected ? 'Connected' : 'Not connected'}
            </span>
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </div>
        </button>

        {expanded && (
          <div className="px-4 pb-4 pt-2 space-y-3 border-b border-foreground/[0.06] last:border-b-0">
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                1. Open the{' '}
                <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener noreferrer" className="underline text-foreground">
                  YouTube Data API v3
                </a>{' '}
                page, choose or create a project, and press Enable.
              </p>
              <p>
                2. In{' '}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="underline text-foreground">
                  Credentials
                </a>
                , choose Create credentials, then API key, and limit it to YouTube Data API v3.
              </p>
              <p>3. Paste it here. It is free, and Helprr stays well inside the daily limit.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="youtube-api-key" className="text-xs text-muted-foreground">API key</Label>
              <Input
                id="youtube-api-key"
                type="password"
                value={apiKey}
                autoComplete="off"
                placeholder={connected ? 'Saved. Paste a new key to replace it' : undefined}
                onChange={(e) => setApiKey(e.target.value)}
                className="h-10 text-base md:text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy || !apiKey.trim()} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
              <Button variant="outline" className="flex-1" disabled={busy || (!connected && !apiKey.trim())} onClick={() => testMutation.mutate()}>
                {testMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Test
              </Button>
            </div>
            {connected && (
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
