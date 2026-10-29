'use client';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Check, CircleAlert, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/query-fetch';
import type { FallbackCheck } from '@/lib/manual-downloads/fallback';
import { newRequestId, type FallbackDraft } from './manual-download-form';

interface FallbackActionsProps {
  hash: string;
  draft: FallbackDraft;
  source: 'MAGNET' | 'TORRENT_FILE';
  selectedIndexes: number[];
  disabled: boolean;
  /** Settles anything still changing the torrent (a late stop), so it cannot land after the start. */
  beforeStart: () => Promise<void>;
  cancelling: boolean;
  onCancel: () => void;
}

const APP = { RADARR: 'Radarr', SONARR: 'Sonarr' } as const;

/** The fallback's check and start for one torrent: the file picker waits while either runs. */
export const fallbackMutationKey = (hash: string) => ['manual-downloads', 'fallback', hash] as const;

/**
 * The last step of the advanced fallback, under the file picker: Check what
 * Helprr will do with exactly these files, then start; the torrent only
 * downloads once started, and only the chosen files.
 */
export function FallbackActions({ hash, draft, source, selectedIndexes, disabled, beforeStart, cancelling, onCancel }: FallbackActionsProps) {
  const router = useRouter();
  const app = APP[draft.service];
  const [checked, setChecked] = useState<{ key: string; result: FallbackCheck } | null>(null);
  const requestIdRef = useRef<{ key: string; id: string } | null>(null);
  const body = {
    service: draft.service,
    instanceId: draft.instanceId,
    externalId: draft.externalId,
    infoHash: hash,
    selectedFileIndexes: selectedIndexes,
    source,
    ...(draft.add ? { add: draft.add } : {}),
  };
  const key = JSON.stringify(body);
  const result = checked?.key === key ? checked.result : null;
  // Fixed when a button is pressed: an answer belongs to what was asked, not to what is on screen when it arrives.
  type Asked = { key: string; body: typeof body };

  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) return;
    toast.error(error instanceof Error ? error.message : 'Something went wrong');
  };
  const post = async (path: string, payload: Record<string, unknown>) => {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { res, data: await res.json().catch(() => null) };
  };
  const check = useMutation({
    mutationKey: fallbackMutationKey(hash),
    mutationFn: async (asked: Asked) => {
      const { res, data } = await post('/api/manual-downloads/fallback/check', asked.body);
      if (!res.ok) throw new ApiError(res.status, data?.error || 'The check could not run');
      return data as FallbackCheck;
    },
    onSuccess: (data, asked) => setChecked({ key: asked.key, result: data }),
    onError,
  });
  const start = useMutation({
    mutationKey: fallbackMutationKey(hash),
    mutationFn: async (asked: Asked) => {
      await beforeStart();
      if (requestIdRef.current?.key !== asked.key) requestIdRef.current = { key: asked.key, id: newRequestId() };
      const { res, data } = await post('/api/manual-downloads/fallback', { ...asked.body, clientRequestId: requestIdRef.current.id });
      if (res.status === 409 && data?.plan) return { refused: data as FallbackCheck };
      if (!res.ok) throw new ApiError(res.status, data?.error || 'The download could not be started');
      return { download: data.download as { id: string; status: string } };
    },
    onSuccess: (outcome, asked) => {
      if ('refused' in outcome && outcome.refused) {
        setChecked({ key: asked.key, result: outcome.refused });
        return;
      }
      const download = outcome.download!;
      if (download.status === 'DOWNLOADING') toast.success('Downloading the chosen files');
      else toast.warning('Started, but it needs a look');
      router.push(`/torrents/linked/${download.id}`);
    },
    onError,
  });
  const busy = disabled || check.isPending || start.isPending || cancelling;

  return (
    <div className="space-y-3 pb-4">
      {result && <FallbackSummary result={result} app={app} />}
      {result?.ok ? (
        <Button className="w-full" onClick={() => start.mutate({ key, body })} disabled={busy || selectedIndexes.length === 0}>
          {start.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Start download
        </Button>
      ) : (
        <Button className="w-full" onClick={() => check.mutate({ key, body })} disabled={busy || selectedIndexes.length === 0}>
          {check.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {checked ? 'Check again' : 'Check'}
        </Button>
      )}
      <Button variant="outline" className="w-full" onClick={onCancel} disabled={busy}>
        {cancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Cancel and remove the torrent
      </Button>
    </div>
  );
}

function FallbackSummary({ result, app }: { result: FallbackCheck; app: string }) {
  const { plan } = result;
  const chosen = plan.torrent?.files.filter((file) => file.selected).length ?? 0;
  return (
    <section className={`space-y-3 rounded-lg border p-3 ${result.ok ? 'border-green-500/40' : 'border-destructive/40'}`} aria-live="polite" aria-label="Check result">
      <p className={`flex items-center gap-2 text-sm font-medium ${result.ok ? 'text-green-500' : 'text-destructive'}`}>
        {result.ok ? <Check className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
        {result.ok ? 'Ready to download' : 'Not ready to start'}
      </p>
      <dl className="space-y-1.5 text-xs">
        {plan.target && (
          <div><dt className="inline text-muted-foreground">For: </dt><dd className="inline">{plan.target.title}{plan.target.year ? ` (${plan.target.year})` : ''}{plan.target.existingId ? '' : `, will be added to ${plan.instance?.label ?? app} with searches off`}</dd></div>
        )}
        {plan.torrent && <div><dt className="inline text-muted-foreground">Files: </dt><dd className="inline">{chosen} of {plan.torrent.files.length} chosen</dd></div>}
        {plan.arrSavePath && <div><dt className="inline text-muted-foreground">{app} sees the download folder at: </dt><dd className="inline [overflow-wrap:anywhere] font-mono">{plan.arrSavePath}</dd></div>}
      </dl>
      <p className="text-xs text-muted-foreground">
        When the files finish, Helprr asks {app} what each one is and imports them. If {app} is unsure of any file, you choose what it is first.
      </p>
      {result.errors.length > 0 && (
        <ul className="space-y-1.5">
          {result.errors.map((issue) => (
            <li key={issue.code} className="flex gap-2 text-xs text-destructive"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issue.message}</li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {result.warnings.map((issue) => (
            <li key={issue.code} className="flex gap-2 text-xs text-amber-500"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issue.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
