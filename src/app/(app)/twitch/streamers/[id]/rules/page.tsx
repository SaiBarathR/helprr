'use client';

import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StreamerRules } from '@/components/twitch/streamer-rules';

export default function TwitchStreamerRulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const back = `/twitch/streamers/${id}`;

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
        onBack={dirty ? () => setConfirmLeave(true) : undefined}
      />
      <div className="pt-3">
        <StreamerRules streamerId={id} onDirtyChange={setDirty} />
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
