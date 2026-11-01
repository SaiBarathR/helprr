'use client';

import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CreatorRules } from '@/components/creators/creator-rules';
import type { RuleLayerValue } from '@/components/creators/policy-editor';

export default function YoutubeChannelRulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [draft, setDraft] = useState<RuleLayerValue | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const back = `/youtube/channels/${id}`;

  const channel = useQuery({
    queryKey: ['youtube', 'streamer', id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/youtube/channels/${id}`, { signal });
      if (!res.ok) throw new Error('Failed to load the channel');
      return (await res.json()) as { displayName: string };
    },
  });

  return (
    <div className="animate-content-in">
      <PageHeader
        title="Download rules"
        subtitle={channel.data?.displayName}
        backHref={back}
        onBack={draft ? () => setConfirmLeave(true) : undefined}
      />
      <div className="pt-3">
        <CreatorRules platform="youtube" creatorId={id} draft={draft} setDraft={setDraft} />
      </div>
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Discard unsaved changes?"
        description="Your rule edits haven't been saved. Leaving now will discard them."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => router.push(back)}
      />
    </div>
  );
}
