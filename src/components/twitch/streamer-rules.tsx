'use client';

import type { Dispatch, SetStateAction } from 'react';
import { CreatorRules } from '@/components/creators/creator-rules';
import type { RuleLayerValue } from '@/components/creators/policy-editor';

export function StreamerRules({ streamerId, draft, setDraft }: {
  streamerId: string;
  draft: RuleLayerValue | null;
  setDraft: Dispatch<SetStateAction<RuleLayerValue | null>>;
}) {
  return <CreatorRules platform="twitch" creatorId={streamerId} draft={draft} setDraft={setDraft} />;
}
