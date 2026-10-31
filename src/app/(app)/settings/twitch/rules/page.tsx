'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { RuleLayers, type RuleLayerValue } from '@/components/twitch/policy-editor';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { FloatingActionBar } from '@/components/ui/floating-action-bar';
import { useUnsavedChangesGuard } from '@/lib/hooks/use-unsaved-changes-guard';
import type { PolicyLayer } from '@/lib/twitch/policy';

interface GlobalPolicies {
  defaultPolicy: PolicyLayer;
  typePolicies: RuleLayerValue['types'];
}

export default function TwitchGlobalRulesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<RuleLayerValue | null>(null);
  // The fields keep their own text, so a discard has to rebuild them.
  const [revision, setRevision] = useState(0);
  const [confirmLeave, setConfirmLeave] = useState(false);
  useUnsavedChangesGuard(rules !== null);

  const policies = useQuery({
    queryKey: ['twitch', 'policies'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/twitch/policies', { signal });
      if (!res.ok) throw new Error('Could not load the rules');
      return (await res.json()) as GlobalPolicies;
    },
  });

  const save = useMutation({
    mutationFn: async (saved: RuleLayerValue) => {
      const res = await fetch('/api/twitch/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultPolicy: saved.base, typePolicies: saved.types }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not save');
    },
    onSuccess: (_data, saved) => {
      toast.success('Rules saved');
      queryClient.setQueryData<GlobalPolicies>(['twitch', 'policies'], (data) => data && {
        ...data,
        defaultPolicy: saved.base,
        typePolicies: saved.types,
      });
      // An edit made while this was saving is still unsaved.
      setRules((current) => (current === saved ? null : current));
      void queryClient.invalidateQueries({ queryKey: ['twitch'] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="animate-content-in">
      <div className="px-1 pb-2 pt-1">
        <button
          type="button"
          onClick={() => (rules ? setConfirmLeave(true) : router.push('/settings/twitch'))}
          className="-ml-1 inline-flex min-h-[44px] items-center gap-1 px-1 text-sm text-primary"
        >
          <ChevronLeft className="h-5 w-5" />
          Twitch
        </button>
      </div>
      <div className="mb-4 px-4">
        <h1 className="text-2xl font-semibold">Global rules</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What every streamer starts from. A streamer&apos;s own rules override these.
        </p>
      </div>

      {policies.isError ? (
        <ErrorState message="Couldn't load the rules" onRetry={() => void policies.refetch()} />
      ) : !policies.data ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <RuleLayers
          key={revision}
          value={rules ?? { base: policies.data.defaultPolicy, types: policies.data.typePolicies }}
          footer="Dimmed settings use Helprr's default"
          onChange={setRules}
        />
      )}

      {rules !== null && (
        <FloatingActionBar>
          <span className="min-w-0 flex-1 text-sm text-muted-foreground">Unsaved changes</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={save.isPending}
            onClick={() => {
              setRules(null);
              setRevision((current) => current + 1);
            }}
          >
            Discard
          </Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(rules)}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </FloatingActionBar>
      )}

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Discard unsaved changes?"
        description="Your rule edits haven't been saved. Leaving now will discard them."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => router.push('/settings/twitch')}
      />
    </div>
  );
}
