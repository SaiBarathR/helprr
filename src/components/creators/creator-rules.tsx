'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { FloatingActionBar } from '@/components/ui/floating-action-bar';
import { useUnsavedChangesGuard } from '@/lib/hooks/use-unsaved-changes-guard';
import type { PolicyLayer, TwitchPolicy } from '@/lib/archive/policy';
import { applyPreset, PRESETS, presetOf } from '@/lib/youtube/presets';
import { RuleLayers, type RuleLayerValue } from '@/components/creators/policy-editor';

type StoredLayers = { policy: PolicyLayer; typePolicies: RuleLayerValue['types'] } | null;

interface PoliciesResponse {
  builtIn?: TwitchPolicy;
  defaultPolicy: PolicyLayer;
  typePolicies: RuleLayerValue['types'];
  streamer?: StoredLayers;
  channel?: StoredLayers;
}

interface PreviewRow {
  id: string;
  title: string;
  autoDownload: boolean;
  reason: string;
}

// Twitch's routes say streamer and YouTube's say channel. Everything else here is the same.
const WORDS = {
  twitch: { idField: 'streamerId', storedField: 'streamer' },
  youtube: { idField: 'channelId', storedField: 'channel' },
} as const;

export function CreatorRules({ platform, creatorId, draft, setDraft }: {
  platform: 'twitch' | 'youtube';
  creatorId: string;
  draft: RuleLayerValue | null;
  setDraft: Dispatch<SetStateAction<RuleLayerValue | null>>;
}) {
  const queryClient = useQueryClient();
  const api = `/api/${platform}/policies`;
  const { idField, storedField } = WORDS[platform];
  // The fields keep their own text, so a discard has to rebuild them.
  const [revision, setRevision] = useState(0);
  useUnsavedChangesGuard(draft !== null);

  const stored = useQuery({
    queryKey: [platform, 'policies', creatorId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${api}?${idField}=${creatorId}`, { signal });
      if (!res.ok) throw new Error('Could not load the rules');
      return (await res.json()) as PoliciesResponse;
    },
  });
  const saved = stored.data?.[storedField];
  const value: RuleLayerValue = draft ?? { base: saved?.policy ?? {}, types: saved?.typePolicies ?? {} };

  const post = async (url: string, method: string, body: unknown) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || 'Request failed');
    return data;
  };

  const preview = useMutation({
    mutationFn: () => post(`${api}/preview`, 'POST', { [idField]: creatorId, policy: value.base, typePolicies: value.types }) as Promise<{ results: PreviewRow[] }>,
    onError: (error) => toast.error(error.message),
  });
  const save = useMutation({
    mutationFn: (saved: RuleLayerValue) => post(api, 'PUT', { [idField]: creatorId, policy: saved.base, typePolicies: saved.types }),
    onSuccess: (_data, saved) => {
      toast.success('Rules saved');
      queryClient.setQueryData<PoliciesResponse>([platform, 'policies', creatorId], (data) => data && {
        ...data,
        [storedField]: { policy: saved.base, typePolicies: saved.types },
      });
      // An edit made while this was saving is still unsaved.
      setDraft((current) => (current === saved ? null : current));
      void queryClient.invalidateQueries({ queryKey: [platform, 'policies'] });
    },
    onError: (error) => toast.error(error.message),
  });

  if (stored.isError) return <ErrorState message="Couldn't load the rules" onRetry={() => void stored.refetch()} />;
  if (!stored.data) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const results = preview.data?.results ?? [];
  const matching = results.filter((row) => row.autoDownload).length;
  const preset = presetOf(value);

  return (
    <>
      {platform === 'youtube' && (
        <GroupedSection title="Downloads" footer="Choosing one keeps your other settings. Change anything below for rules of your own.">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={preset === item.id}
              onClick={() => {
                setDraft(applyPreset(value, item.id));
                setRevision((current) => current + 1);
              }}
              className="grouped-row w-full gap-3 text-left active:bg-foreground/5"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{item.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{item.description}</span>
              </span>
              {preset === item.id && <Check aria-hidden className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          ))}
          {preset === null && <div className="grouped-row gap-3"><span className="text-sm">Custom</span><Check aria-hidden className="h-4 w-4 shrink-0 text-primary" /></div>}
        </GroupedSection>
      )}
      <RuleLayers
        key={revision}
        value={value}
        inherited={stored.data.defaultPolicy as Partial<TwitchPolicy>}
        inheritedTypes={stored.data.typePolicies}
        footer="Dimmed settings follow the global rules"
        onChange={setDraft}
        variant={platform}
        builtIn={stored.data.builtIn}
      />

      <Button variant="secondary" className="mb-6 h-10 w-full rounded-full" disabled={preview.isPending} onClick={() => preview.mutate()}>
        {preview.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Try on recent videos
      </Button>
      {preview.isSuccess && (
        <GroupedSection title={`${matching} of the last ${results.length} would download`}>
          {results.map((row) => (
            <div key={row.id} className="grouped-row gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm">{row.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{row.reason}</span>
              </span>
              {row.autoDownload
                ? <Check aria-label="Would download" className="h-4 w-4 shrink-0 text-green-500" />
                : <X aria-label="Would skip" className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </div>
          ))}
        </GroupedSection>
      )}

      {draft !== null && (
        <FloatingActionBar>
          <span className="min-w-0 flex-1 text-sm text-muted-foreground">Unsaved changes</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={save.isPending}
            onClick={() => {
              setDraft(null);
              setRevision((current) => current + 1);
            }}
          >
            Discard
          </Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </FloatingActionBar>
      )}
    </>
  );
}
