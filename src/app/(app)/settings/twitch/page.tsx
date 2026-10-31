'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { GroupedSection } from '@/components/settings/grouped-section';
import { NumberRow, ROW_INPUT, SwitchRow } from '@/components/twitch/setting-rows';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Settings {
  autoDownloadEnabled: boolean;
  jellyfinLibraryPath: string | null;
  reencodeEnabled: boolean;
  reencodeGlobalQuality: number;
  reencodeWindowStart: string;
  reencodeWindowEnd: string;
  keepOriginalDays: number;
  reencodeWaiting: number;
  reencodeWaitingBytes: number;
  maxConcurrentDownloads: number;
  minFreeGb: number;
  pinnedTools: { ytdlp?: string; td?: string };
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

function reencodeFooter(settings: Settings | undefined): string {
  const waiting = settings?.reencodeWaiting ?? 0;
  if (waiting === 0 || !settings) return 'Nothing waiting';
  return `${waiting} waiting, ${(settings.reencodeWaitingBytes / 1024 ** 3).toFixed(1)} GB in total`;
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

function TimeRow({ label, defaultValue, onCommit }: { label: string; defaultValue: string; onCommit: (value: string) => void }) {
  return (
    <label className="grouped-row cursor-text gap-3">
      <span className="text-sm">{label}</span>
      <input
        type="time"
        aria-label={label}
        defaultValue={defaultValue}
        onBlur={(event) => onCommit(event.target.value)}
        className={cn(ROW_INPUT, 'text-muted-foreground [color-scheme:dark] light:[color-scheme:light]')}
      />
    </label>
  );
}

function VersionRow({ label, defaultValue, onCommit }: { label: string; defaultValue?: string; onCommit: (value: string) => void }) {
  return (
    <label className="grouped-row cursor-text gap-3">
      <span className="shrink-0 text-sm">{label}</span>
      <input
        aria-label={`${label} version`}
        placeholder="Not pinned"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        defaultValue={defaultValue}
        onBlur={(event) => onCommit(event.target.value)}
        className={cn(ROW_INPUT, 'w-36 text-muted-foreground')}
      />
    </label>
  );
}

export default function TwitchSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['twitch', 'settings'], queryFn: ({ signal }) => load<Settings>('/api/twitch/settings', signal) });
  const library = useQuery({ queryKey: ['twitch', 'library'], queryFn: ({ signal }) => load<LibraryStatus>('/api/twitch/library', signal), retry: false });

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
  const saveSettings = useMutation({
    mutationFn: (patch: Partial<Settings>) => send('/api/twitch/settings', 'PUT', patch),
    onSuccess: refresh,
    onError: fail,
  });
  const savePin = (tool: 'ytdlp' | 'td', value: string) => {
    const pins = { ...settings.data?.pinnedTools };
    if ((pins[tool] ?? '') === value.trim()) return;
    if (value.trim()) pins[tool] = value.trim();
    else delete pins[tool];
    saveSettings.mutate({ pinnedTools: pins });
  };
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
    mutationFn: () => load<{ candidates: RetentionCandidate[]; previewToken: string }>('/api/twitch/retention/preview', new AbortController().signal),
    onError: fail,
  });
  const candidates = preview.data?.candidates ?? [];
  const runRetention = useMutation({
    mutationFn: () => send('/api/twitch/retention/run', 'POST', { fileIds: candidates.map((candidate) => candidate.fileId), previewToken: preview.data?.previewToken }),
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
  const data = settings.data;

  return (
    <div className="animate-content-in">
      <div className="px-1 pb-2 pt-1">
        <Link href="/settings" className="-ml-1 inline-flex min-h-[44px] items-center gap-1 px-1 text-sm text-primary">
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>
      <div className="mb-4 px-4">
        <h1 className="text-2xl font-semibold">Twitch</h1>
        <p className="mt-1 text-sm text-muted-foreground">What Helprr saves from Twitch, and how long it keeps it.</p>
      </div>

      <GroupedSection
        title="Automatic downloads"
        footer={data?.autoDownloadEnabled ? 'Rules decide what downloads' : 'Off: nothing downloads by itself, whatever the rules say'}
      >
        <SwitchRow
          label="Auto-download"
          checked={data?.autoDownloadEnabled ?? false}
          disabled={!data || toggle.isPending}
          onCheckedChange={(checked) => toggle.mutate(checked)}
        />
        <Link href="/settings/twitch/rules" className="grouped-row gap-3 hover:bg-foreground/[0.03] active:bg-foreground/5">
          <span className="text-sm">Global rules</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </GroupedSection>

      <GroupedSection
        title="Night re-encode"
        footer={worker.data?.seen && !worker.data.gpuAvailable ? 'No Intel GPU found: re-encoding stays idle' : reencodeFooter(data)}
      >
        <SwitchRow
          label="Re-encode to HEVC"
          checked={data?.reencodeEnabled ?? false}
          disabled={!data || saveSettings.isPending}
          onCheckedChange={(reencodeEnabled) => saveSettings.mutate({ reencodeEnabled })}
        />
        {data && (
          <>
            <TimeRow label="Starts" defaultValue={data.reencodeWindowStart} onCommit={(reencodeWindowStart) => saveSettings.mutate({ reencodeWindowStart })} />
            <TimeRow label="Ends" defaultValue={data.reencodeWindowEnd} onCommit={(reencodeWindowEnd) => saveSettings.mutate({ reencodeWindowEnd })} />
            <NumberRow label="Quality (lower is better)" min={1} max={51} defaultValue={data.reencodeGlobalQuality} onBlur={(event) => saveSettings.mutate({ reencodeGlobalQuality: Number(event.target.value) })} />
            <NumberRow label="Keep originals" unit="days" min={0} max={365} defaultValue={data.keepOriginalDays} onBlur={(event) => saveSettings.mutate({ keepOriginalDays: Number(event.target.value) })} />
          </>
        )}
      </GroupedSection>

      <GroupedSection title="Downloads">
        {data && (
          <>
            <NumberRow label="At the same time" min={1} max={6} defaultValue={data.maxConcurrentDownloads} onBlur={(event) => saveSettings.mutate({ maxConcurrentDownloads: Number(event.target.value) })} />
            <NumberRow label="Keep free on disk" unit="GB" min={1} defaultValue={data.minFreeGb} onBlur={(event) => saveSettings.mutate({ minFreeGb: Number(event.target.value) })} />
          </>
        )}
      </GroupedSection>

      <GroupedSection title="Tool versions" footer="Empty follows the tested version and updates. A pin stays until you clear it">
        {data && (
          <>
            <VersionRow label="yt-dlp" defaultValue={data.pinnedTools.ytdlp} onCommit={(value) => savePin('ytdlp', value)} />
            <VersionRow label="TwitchDownloader" defaultValue={data.pinnedTools.td} onCommit={(value) => savePin('td', value)} />
          </>
        )}
      </GroupedSection>

      <GroupedSection title="Twitch browser token" footer="Only for sub-only VODs and 1440p. It grants full access to your Twitch account">
        {data?.hasBrowserAuthToken ? (
          <div className="grouped-row gap-3">
            <span className={cn('text-sm', data.browserAuthTokenValid === false && 'text-amber-400')}>
              {data.browserAuthTokenValid === false ? 'Stopped working' : 'Saved'}
            </span>
            <button type="button" disabled={removeToken.isPending} onClick={() => removeToken.mutate()} className="min-h-9 px-1 text-sm text-destructive">
              Remove
            </button>
          </div>
        ) : (
          <form
            className="flex items-center gap-2 px-4 py-2"
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
            />
            <Button type="submit" size="sm" className="shrink-0" disabled={!browserToken.trim() || saveToken.isPending}>Save</Button>
          </form>
        )}
      </GroupedSection>

      <GroupedSection title="Retention" footer="Set limits in the rules. Keep-forever files are never deleted">
        <button
          type="button"
          disabled={preview.isPending}
          onClick={() => preview.mutate()}
          className="grouped-row w-full gap-3 text-left hover:bg-foreground/[0.03] active:bg-foreground/5"
        >
          <span className="text-sm">Preview what would be deleted</span>
          {preview.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>
        {preview.data && candidates.length === 0 && (
          <div className="grouped-row"><span className="text-sm text-muted-foreground">Nothing to delete</span></div>
        )}
        {candidates.map((candidate) => (
          <div key={candidate.fileId} className="grouped-row gap-3">
            <span className="min-w-0">
              <span className="block truncate text-sm">{candidate.title}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {candidate.streamer} · {(candidate.sizeBytes / 1024 ** 3).toFixed(1)} GB · {candidate.reason}
              </span>
            </span>
          </div>
        ))}
        {candidates.length > 0 && (
          <div className="px-4 py-3">
            <Button variant="destructive" className="h-10 w-full rounded-full" onClick={() => setConfirmRetention(true)}>
              Delete {candidates.length} {candidates.length === 1 ? 'file' : 'files'}
            </Button>
          </div>
        )}
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

      <GroupedSection
        title="Jellyfin library"
        footer={status?.exists ? 'Exclude this library from the Intro Skipper plugin, if you use it' : 'Creating a library changes your real Jellyfin'}
      >
        {status?.exists ? (
          <>
            <div className="grouped-row gap-3"><span className="text-sm">Library</span><span className="truncate text-sm text-muted-foreground">{status.name}</span></div>
            <div className="grouped-row gap-3">
              <span className="text-sm">Internet metadata</span>
              <span className={cn('text-sm', status.fetchersOff ? 'text-muted-foreground' : 'text-amber-400')}>{status.fetchersOff ? 'Off' : 'On: turn it off'}</span>
            </div>
          </>
        ) : (
          <div className="space-y-2 px-4 py-3">
            {status?.conflicts?.length ? (
              <p className="text-sm text-amber-400">Already covered by {status.conflicts.join(', ')}.</p>
            ) : null}
            <Input aria-label="Library name" value={libraryName} onChange={(event) => setLibraryName(event.target.value)} />
            <Input
              aria-label="Library path, as Jellyfin sees it"
              placeholder="Path, as Jellyfin sees it"
              value={libraryPath}
              onChange={(event) => setLibraryPath(event.target.value)}
            />
            <Button className="h-10 w-full rounded-full" disabled={!libraryPath.trim() || createLibrary.isPending} onClick={() => createLibrary.mutate()}>
              Create library
            </Button>
          </div>
        )}
      </GroupedSection>
    </div>
  );
}
