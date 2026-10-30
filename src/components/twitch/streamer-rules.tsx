'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { PolicyLayer, TwitchPolicy } from '@/lib/twitch/policy';
import { RuleLayers, type RuleLayerValue } from './policy-editor';

interface PoliciesResponse {
  defaultPolicy: PolicyLayer;
  streamer: { policy: PolicyLayer; typePolicies: RuleLayerValue['types'] } | null;
}

interface PreviewRow {
  id: string;
  title: string;
  autoDownload: boolean;
  reason: string;
}

export function StreamerRules({ streamerId }: { streamerId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RuleLayerValue | null>(null);

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

  if (stored.isError) return <p className="py-8 text-center text-sm text-muted-foreground">Could not load the rules.</p>;
  if (!stored.data) return null;

  const results = preview.data?.results ?? [];
  const matching = results.filter((row) => row.autoDownload).length;

  return (
    <div className="space-y-3">
      <RuleLayers value={value} inherited={stored.data.defaultPolicy as Partial<TwitchPolicy>} onChange={setDraft} />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-10" disabled={preview.isPending} onClick={() => preview.mutate()}>Preview</Button>
        <Button className="h-10" disabled={save.isPending || draft === null} onClick={() => save.mutate()}>Save</Button>
      </div>
      {preview.isSuccess && (
        <section aria-label="Preview">
          <p className="mb-1.5 text-sm text-muted-foreground">{matching} of the last {results.length} videos would download.</p>
          <div className="grouped-section-content max-h-80 overflow-y-auto">
            {results.map((row) => (
              <div key={row.id} className="grouped-row gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{row.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{row.reason}</span>
                </span>
                {row.autoDownload ? <Check className="h-4 w-4 shrink-0 text-emerald-500" /> : <X className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
