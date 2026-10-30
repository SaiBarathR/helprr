'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { GroupedSection } from '@/components/settings/grouped-section';
import { PolicyEditor } from '@/components/twitch/policy-editor';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { PolicyLayer } from '@/lib/twitch/policy';

interface Settings {
  autoDownloadEnabled: boolean;
  jellyfinLibraryPath: string | null;
  reencodeEnabled: boolean;
  reencodeGlobalQuality: number;
  reencodeWindowStart: string;
  reencodeWindowEnd: string;
  keepOriginalDays: number;
  reencodeWaiting: number;
  hasBrowserAuthToken: boolean;
  browserAuthTokenValid: boolean | null;
}

interface RetentionCandidate {
  fileId: string;
  title: string;
  streamer: string;
  sizeBytes: number;
  reason: string;
}

interface LibraryStatus {
  configured?: boolean;
  path?: string;
  exists?: boolean;
  name?: string | null;
  fetchersOff?: boolean;
  conflicts?: string[];
  error?: string;
}

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Could not save');
  return data;
}

async function load<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Could not load');
  return data as T;
}

export default function TwitchSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['twitch', 'settings'], queryFn: ({ signal }) => load<Settings>('/api/twitch/settings', signal) });
  const library = useQuery({ queryKey: ['twitch', 'library'], queryFn: ({ signal }) => load<LibraryStatus>('/api/twitch/library', signal), retry: false });
  const policies = useQuery({ queryKey: ['twitch', 'policies'], queryFn: ({ signal }) => load<{ defaultPolicy: PolicyLayer }>('/api/twitch/policies', signal) });

  const [rules, setRules] = useState<PolicyLayer | null>(null);
  const [libraryName, setLibraryName] = useState('Twitch');
  const [browserToken, setBrowserToken] = useState('');
  const [confirmRetention, setConfirmRetention] = useState(false);
  const [typedPath, setLibraryPath] = useState<string | null>(null);
  const libraryPath = typedPath ?? library.data?.path ?? '';

  const worker = useQuery({
    queryKey: ['twitch', 'worker'],
    queryFn: ({ signal }) => load<{ seen: boolean; gpuAvailable?: boolean }>('/api/twitch/worker', signal),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['twitch'] });
  const fail = (error: Error) => toast.error(error.message);

  const toggle = useMutation({
    mutationFn: (autoDownloadEnabled: boolean) => send('/api/twitch/settings', 'PUT', { autoDownloadEnabled }),
    onSuccess: refresh,
    onError: fail,
  });
  const saveRules = useMutation({
    mutationFn: () => send('/api/twitch/policies', 'PUT', { defaultPolicy: rules ?? policies.data?.defaultPolicy ?? {} }),
    onSuccess: () => {
      toast.success('Rules saved');
      refresh();
    },
    onError: fail,
  });
  const saveSettings = useMutation({
    mutationFn: (patch: Partial<Settings>) => send('/api/twitch/settings', 'PUT', patch),
    onSuccess: refresh,
    onError: fail,
  });
  const saveToken = useMutation({
    mutationFn: () => send('/api/twitch/browser-token', 'PUT', { token: browserToken.trim() }),
    onSuccess: () => {
      setBrowserToken('');
      toast.success('Token saved');
      refresh();
    },
    onError: fail,
  });
  const removeToken = useMutation({
    mutationFn: () => send('/api/twitch/browser-token', 'DELETE', {}),
    onSuccess: refresh,
    onError: fail,
  });
  const preview = useMutation({
    mutationFn: async () => (await load<{ candidates: RetentionCandidate[] }>('/api/twitch/retention/preview', new AbortController().signal)).candidates,
    onError: fail,
  });
  const runRetention = useMutation({
    mutationFn: () => send('/api/twitch/retention/run', 'POST', { fileIds: (preview.data ?? []).map((candidate) => candidate.fileId) }),
    onSuccess: (data: { queued: number; skipped: number }) => {
      toast.success(`${data.queued} queued for deletion${data.skipped ? `, ${data.skipped} no longer apply` : ''}`);
      setConfirmRetention(false);
      preview.reset();
      refresh();
    },
    onError: fail,
  });
  const createLibrary = useMutation({
    mutationFn: () => send('/api/twitch/library', 'POST', { name: libraryName, path: libraryPath }),
    onSuccess: () => {
      toast.success('Library is ready');
      refresh();
    },
    onError: fail,
  });

  const status = library.data;

  return (
    <div className="animate-content-in pb-8">
      <PageHeader title="Twitch" backHref="/settings" />
      <div className="px-4 pt-2">
        <GroupedSection
          title="Automatic downloads"
          footer={settings.data?.autoDownloadEnabled ? 'Rules decide what downloads' : 'Off: nothing downloads by itself, whatever the rules say'}
        >
          <div className="grouped-row min-h-11">
            <span className="text-sm">Auto-download</span>
            <Switch
              aria-label="Auto-download"
              checked={settings.data?.autoDownloadEnabled ?? false}
              disabled={!settings.data || toggle.isPending}
              onCheckedChange={(checked) => toggle.mutate(checked)}
            />
          </div>
        </GroupedSection>

        <div className="grouped-section mb-6">
          <div className="grouped-section-title">Global rules</div>
          {policies.data && (
            <PolicyEditor key="global" value={rules ?? policies.data.defaultPolicy} onChange={setRules} />
          )}
          <Button className="mt-3 h-10 w-full" disabled={saveRules.isPending || rules === null} onClick={() => saveRules.mutate()}>
            Save rules
          </Button>
        </div>

        <GroupedSection
          title="Night re-encode"
          footer={worker.data?.seen && !worker.data.gpuAvailable ? 'No Intel GPU found: re-encoding stays idle' : `${settings.data?.reencodeWaiting ?? 0} waiting. Saves about 63–82% of the space`}
        >
          <div className="grouped-row min-h-11">
            <span className="text-sm">Re-encode to HEVC</span>
            <Switch
              aria-label="Re-encode to HEVC"
              checked={settings.data?.reencodeEnabled ?? false}
              disabled={!settings.data || saveSettings.isPending}
              onCheckedChange={(reencodeEnabled) => saveSettings.mutate({ reencodeEnabled })}
            />
          </div>
          {settings.data && (
            <>
              <label className="grouped-row min-h-11">
                <span className="text-sm">Starts</span>
                <input type="time" aria-label="Window start" defaultValue={settings.data.reencodeWindowStart} className="bg-transparent text-sm" onBlur={(event) => saveSettings.mutate({ reencodeWindowStart: event.target.value })} />
              </label>
              <label className="grouped-row min-h-11">
                <span className="text-sm">Ends</span>
                <input type="time" aria-label="Window end" defaultValue={settings.data.reencodeWindowEnd} className="bg-transparent text-sm" onBlur={(event) => saveSettings.mutate({ reencodeWindowEnd: event.target.value })} />
              </label>
              <label className="grouped-row min-h-11">
                <span className="text-sm">Quality (lower is better)</span>
                <input type="number" min={1} max={51} aria-label="Quality" defaultValue={settings.data.reencodeGlobalQuality} className="w-14 bg-transparent text-right text-sm" onBlur={(event) => saveSettings.mutate({ reencodeGlobalQuality: Number(event.target.value) })} />
              </label>
              <label className="grouped-row min-h-11">
                <span className="text-sm">Keep originals (days)</span>
                <input type="number" min={0} max={365} aria-label="Keep originals in days" defaultValue={settings.data.keepOriginalDays} className="w-14 bg-transparent text-right text-sm" onBlur={(event) => saveSettings.mutate({ keepOriginalDays: Number(event.target.value) })} />
              </label>
            </>
          )}
        </GroupedSection>

        <GroupedSection title="Twitch browser token" footer="Only for sub-only VODs and 1440p. It grants full access to your Twitch account">
          {settings.data?.hasBrowserAuthToken ? (
            <div className="grouped-row min-h-11">
              <span className={`text-sm ${settings.data.browserAuthTokenValid === false ? 'text-amber-400' : ''}`}>
                {settings.data.browserAuthTokenValid === false ? 'Stopped working' : 'Saved'}
              </span>
              <Button variant="ghost" size="sm" disabled={removeToken.isPending} onClick={() => removeToken.mutate()}>Remove</Button>
            </div>
          ) : (
            <form
              className="flex gap-2 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                saveToken.mutate();
              }}
            >
              <Input
                type="password"
                aria-label="Twitch auth-token cookie"
                placeholder="auth-token cookie"
                autoComplete="off"
                value={browserToken}
                onChange={(event) => setBrowserToken(event.target.value)}
                className="h-10"
              />
              <Button type="submit" className="h-10 shrink-0" disabled={!browserToken.trim() || saveToken.isPending}>Save</Button>
            </form>
          )}
        </GroupedSection>

        <GroupedSection title="Retention" footer="Set limits in the rules. Keep-forever files are never deleted">
          <div className="space-y-2 p-3">
            <Button variant="outline" className="h-10 w-full" disabled={preview.isPending} onClick={() => preview.mutate()}>
              Preview what would be deleted
            </Button>
            {preview.data && preview.data.length === 0 && <p className="text-sm text-muted-foreground">Nothing to delete.</p>}
            {preview.data && preview.data.length > 0 && (
              <>
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {preview.data.map((candidate) => (
                    <li key={candidate.fileId} className="text-sm">
                      <span className="block truncate">{candidate.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{candidate.streamer} · {(candidate.sizeBytes / 1024 ** 3).toFixed(1)} GB · {candidate.reason}</span>
                    </li>
                  ))}
                </ul>
                <Button variant="destructive" className="h-10 w-full" onClick={() => setConfirmRetention(true)}>
                  Delete {preview.data.length} {preview.data.length === 1 ? 'file' : 'files'}
                </Button>
              </>
            )}
          </div>
        </GroupedSection>
        <ConfirmDialog
          open={confirmRetention}
          onOpenChange={setConfirmRetention}
          title="Delete these files?"
          description="They are removed from the disk and from Jellyfin. This cannot be undone."
          confirmLabel="Delete"
          destructive
          busy={runRetention.isPending}
          onConfirm={() => runRetention.mutate()}
        />

        <GroupedSection title="Jellyfin library" footer="Creating a library changes your real Jellyfin">
          {status?.exists ? (
            <>
              <div className="grouped-row"><span className="text-sm">Library</span><span className="truncate text-sm text-muted-foreground">{status.name}</span></div>
              <div className="grouped-row">
                <span className="text-sm">Internet metadata</span>
                <span className={`text-sm ${status.fetchersOff ? 'text-emerald-400' : 'text-amber-400'}`}>{status.fetchersOff ? 'Off' : 'On: turn it off'}</span>
              </div>
            </>
          ) : (
            <div className="space-y-2 p-3">
              {status?.conflicts?.length ? (
                <p className="text-sm text-amber-400">Already covered by {status.conflicts.join(', ')}.</p>
              ) : null}
              <Input aria-label="Library name" value={libraryName} onChange={(event) => setLibraryName(event.target.value)} className="h-10" />
              <Input
                aria-label="Library path, as Jellyfin sees it"
                placeholder="Path, as Jellyfin sees it"
                value={libraryPath}
                onChange={(event) => setLibraryPath(event.target.value)}
                className="h-10"
              />
              <Button className="h-10 w-full" disabled={!libraryPath.trim() || createLibrary.isPending} onClick={() => createLibrary.mutate()}>
                Create library
              </Button>
            </div>
          )}
        </GroupedSection>
        <p className="text-xs text-muted-foreground">Exclude this library from the Intro Skipper plugin, if you use it.</p>
      </div>
    </div>
  );
}
