'use client';

import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLeaveConfirm } from '@/lib/hooks/use-unsaved-changes-guard';
import type { RuleLayerValue } from '@/components/creators/policy-editor';
import { StreamerRules } from '@/components/twitch/streamer-rules';

export default function TwitchStreamerRulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [draft, setDraft] = useState<RuleLayerValue | null>(null);
  const back = `/twitch/streamers/${id}`;
  const leave = useLeaveConfirm(draft !== null, back);

  const streamer = useQuery({
    queryKey: ['twitch', 'streamer', id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/twitch/streamers/${id}`, { signal });
      if (!res.ok) throw new Error('Failed to load streamer');
      return (await res.json()) as { displayName: string };
    },
  });

  return (
    <div className="animate-content-in">
      <PageHeader
        title="Download rules"
        subtitle={streamer.data?.displayName}
        backHref={back}
        onBack={draft ? leave.leave : undefined}
      />
      <div className="pt-3">
        <StreamerRules streamerId={id} draft={draft} setDraft={setDraft} />
      </div>
      <ConfirmDialog
        {...leave.dialog}
        title="Discard unsaved changes?"
        description="Your rule edits haven't been saved. Leaving now will discard them."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        destructive
      />
    </div>
  );
}
