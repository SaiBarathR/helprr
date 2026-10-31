'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { FloatingActionBar } from '@/components/ui/floating-action-bar';
import { useUnsavedChangesGuard } from '@/lib/hooks/use-unsaved-changes-guard';
import type { PolicyLayer, TwitchPolicy } from '@/lib/twitch/policy';
import { RuleLayers, type RuleLayerValue } from './policy-editor';

interface PoliciesResponse {
  defaultPolicy: PolicyLayer;
  typePolicies: RuleLayerValue['types'];
  streamer: { policy: PolicyLayer; typePolicies: RuleLayerValue['types'] } | null;
}

interface PreviewRow {
  id: string;
  title: string;
  autoDownload: boolean;
  reason: string;
}

export function StreamerRules({ streamerId, onDirtyChange }: { streamerId: string; onDirtyChange: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraftState] = useState<RuleLayerValue | null>(null);
  // The fields keep their own text, so a discard has to rebuild them.
  const [revision, setRevision] = useState(0);
  useUnsavedChangesGuard(draft !== null);
  const setDraft = (next: RuleLayerValue | null) => {
    setDraftState(next);
    onDirtyChange(next !== null);
  };

  const stored = useQuery({
    queryKey: ['twitch', 'policies', streamerId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/twitch/policies?streamerId=${streamerId}`, { signal });
      if (!res.ok) throw new Error('Could not load the rules');
      return (await res.json()) as PoliciesResponse;
    },
  });
  const value: RuleLayerValue = draft ?? { base: stored.data?.streamer?.policy ?? {}, types: stored.data?.streamer?.typePolicies ?? {} };

  const post = async (url: string, method: string, body: unknown) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || 'Request failed');
    return data;
  };

  const preview = useMutation({
    mutationFn: () => post('/api/twitch/policies/preview', 'POST', { streamerId, policy: value.base, typePolicies: value.types }) as Promise<{ results: PreviewRow[] }>,
    onError: (error) => toast.error(error.message),
  });
  const save = useMutation({
    mutationFn: () => post('/api/twitch/policies', 'PUT', { streamerId, policy: value.base, typePolicies: value.types }),
    onSuccess: () => {
      toast.success('Rules saved');
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['twitch', 'policies'] });
    },
    onError: (error) => toast.error(error.message),
  });

  if (stored.isError) return <ErrorState message="Couldn't load the rules" onRetry={() => void stored.refetch()} />;
  if (!stored.data) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const results = preview.data?.results ?? [];
  const matching = results.filter((row) => row.autoDownload).length;

  return (
    <>
      <RuleLayers
        key={revision}
        value={value}
        inherited={stored.data.defaultPolicy as Partial<TwitchPolicy>}
        inheritedTypes={stored.data.typePolicies}
        footer="Dimmed settings follow the global rules"
        onChange={setDraft}
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
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </FloatingActionBar>
      )}
    </>
  );
}
