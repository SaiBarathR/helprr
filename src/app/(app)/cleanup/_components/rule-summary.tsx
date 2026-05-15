'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import type {
  PrivacyType,
  SeedingRuleShape,
  SlowRuleShape,
  StallRuleShape,
} from '@/lib/cleanup/types';
import { formatBytes } from './size-input';

function privacyLabel(p: PrivacyType): string {
  switch (p) {
    case 'public':
      return 'Public';
    case 'private':
      return 'Private';
    case 'both':
      return 'Public & private';
  }
}

function reSearchLabel(v: boolean | null): string {
  if (v === true) return 'Re-search: on';
  if (v === false) return 'Re-search: off';
  return 'Re-search: inherit';
}

function Chip({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'muted' }) {
  return (
    <Badge
      variant={tone === 'muted' ? 'outline' : 'secondary'}
      className="font-normal whitespace-nowrap"
    >
      {children}
    </Badge>
  );
}

function SummaryRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {children}
    </div>
  );
}

export function StallRuleSummary({ rule }: { rule: StallRuleShape }) {
  return (
    <SummaryRow>
      <Chip>{privacyLabel(rule.privacyType)}</Chip>
      <Chip tone="muted">
        {rule.minCompletionPercentage}–{rule.maxCompletionPercentage}%
      </Chip>
      <Chip tone="muted">{rule.maxStrikes}× strikes</Chip>
      {rule.resetStrikesOnProgress && (
        <Chip tone="muted">
          Reset on {rule.minimumProgressBytes != null ? `+${formatBytes(rule.minimumProgressBytes)}` : 'any progress'}
        </Chip>
      )}
      {rule.changeCategory && <Chip tone="muted">Change category</Chip>}
      {rule.deletePrivate && <Chip tone="muted">Delete private</Chip>}
      <Chip tone="muted">{reSearchLabel(rule.reSearchOverride)}</Chip>
      {rule.priority !== 0 && <Chip tone="muted">priority {rule.priority}</Chip>}
    </SummaryRow>
  );
}

export function SlowRuleSummary({ rule }: { rule: SlowRuleShape }) {
  const speedSegment =
    rule.minSpeedKbps != null
      ? `<${rule.minSpeedKbps} KB/s`
      : null;
  const timeSegment =
    rule.maxTimeHours != null
      ? `>${rule.maxTimeHours} h active`
      : null;
  const trigger = [speedSegment, timeSegment].filter(Boolean).join(' OR ') || 'no speed/time trigger';

  return (
    <SummaryRow>
      <Chip>{privacyLabel(rule.privacyType)}</Chip>
      <Chip tone="muted">
        {rule.minCompletionPercentage}–{rule.maxCompletionPercentage}%
      </Chip>
      <Chip tone="muted">{rule.maxStrikes}× strikes</Chip>
      <Chip tone="muted">{trigger}</Chip>
      {rule.ignoreAboveSizeBytes != null && (
        <Chip tone="muted">Ignore &gt;{formatBytes(rule.ignoreAboveSizeBytes)}</Chip>
      )}
      {rule.resetStrikesOnProgress && <Chip tone="muted">Reset on recovery</Chip>}
      {rule.changeCategory && <Chip tone="muted">Change category</Chip>}
      {rule.deletePrivate && <Chip tone="muted">Delete private</Chip>}
      <Chip tone="muted">{reSearchLabel(rule.reSearchOverride)}</Chip>
      {rule.priority !== 0 && <Chip tone="muted">priority {rule.priority}</Chip>}
    </SummaryRow>
  );
}

export function SeedingRuleSummary({ rule }: { rule: SeedingRuleShape }) {
  const ratioSegment =
    rule.maxRatio >= 0
      ? `ratio ≥ ${rule.maxRatio}${rule.minSeedTimeHours > 0 ? ` & ≥ ${rule.minSeedTimeHours}h seeded` : ''}`
      : 'ratio off';
  const maxTimeSegment =
    rule.maxSeedTimeHours >= 0 ? `or ${rule.maxSeedTimeHours}h cap` : null;

  const categories = rule.categories.length > 0 ? rule.categories.join(', ') : 'any category';

  return (
    <SummaryRow>
      <Chip>{privacyLabel(rule.privacyType)}</Chip>
      <Chip tone="muted" >{categories}</Chip>
      <Chip tone="muted">{ratioSegment}</Chip>
      {maxTimeSegment && <Chip tone="muted">{maxTimeSegment}</Chip>}
      {rule.trackerPatterns.length > 0 && (
        <Chip tone="muted">trackers: {rule.trackerPatterns.join(', ')}</Chip>
      )}
      {rule.tagsAny.length > 0 && <Chip tone="muted">any: {rule.tagsAny.join(', ')}</Chip>}
      {rule.tagsAll.length > 0 && <Chip tone="muted">all: {rule.tagsAll.join(', ')}</Chip>}
      <Chip tone="muted">{rule.deleteSourceFiles ? 'Delete files' : 'Keep files'}</Chip>
      {rule.priority !== 0 && <Chip tone="muted">priority {rule.priority}</Chip>}
    </SummaryRow>
  );
}
