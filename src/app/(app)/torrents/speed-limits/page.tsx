'use client';

import { useState } from 'react';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { useCan } from '@/components/permission-provider';
import { SpeedLimitInput } from '../_components/speed-limit-input';
import { ShareLimitsSection, type ShareLimitField, type ShareLimitValues } from '../_components/share-limits-section';
import { getSpeedLimitTargets } from '../_components/speed-limit-targets';
import { useTorrentAction } from '../_components/use-torrent';

const SHOWN_NAMES = 5;

// The limit every target shares, or null when they differ. qBittorrent reports
// "no limit" as either 0 or -1.
function sharedLimit(values: number[]): number | null {
  const limits = values.map((value) => Math.max(0, value));
  return limits.every((limit) => limit === limits[0]) ? (limits[0] ?? 0) : null;
}

// The share limit every target shares, or null when they differ.
function sharedShareLimit(values: (number | undefined)[]): number | null {
  const limits = values.map((value) => value ?? -2);
  return limits.every((limit) => limit === limits[0]) ? (limits[0] ?? -2) : null;
}

const SHARE_FIELDS: ShareLimitField[] = ['ratio_limit', 'seeding_time_limit', 'inactive_seeding_time_limit'];

export default function BulkSpeedLimitsPage() {
  const router = useRouter();
  const canBandwidth = useCan('torrents.bandwidth');
  const [targets] = useState(getSpeedLimitTargets);
  const runAction = useTorrentAction();
  const [limits, setLimits] = useState(() => ({
    dl_limit: sharedLimit(targets.map((t) => t.dl_limit)),
    up_limit: sharedLimit(targets.map((t) => t.up_limit)),
  }));
  const [shareLimits, setShareLimits] = useState(() =>
    Object.fromEntries(SHARE_FIELDS.map((field) => [field, sharedShareLimit(targets.map((t) => t[field]))])) as Record<ShareLimitField, number | null>);
  const count = targets.length;
  const countLabel = `${count} ${count === 1 ? 'torrent' : 'torrents'}`;

  // Stays on the page after a save, so both limits can be set in one visit.
  const saveLimit = (action: 'setDownloadLimit' | 'setUploadLimit', field: 'dl_limit' | 'up_limit') =>
    async (limit: number) => {
      const ok = await runAction({ hash: targets.map((t) => t.hash).join('|'), action, limit });
      if (ok) setLimits((prev) => ({ ...prev, [field]: limit }));
      return ok;
    };

  const saveShareLimits = async (next: ShareLimitValues) => {
    const ok = await runAction({
      hash: targets.map((t) => t.hash).join('|'),
      action: 'setShareLimits',
      ratioLimit: next.ratio_limit,
      seedingTimeLimit: next.seeding_time_limit,
      inactiveSeedingTimeLimit: next.inactive_seeding_time_limit,
    });
    if (ok) setShareLimits(next);
    return ok;
  };

  if (!canBandwidth) {
    return (
      <>
        <PageHeader title="Set Limits" />
        <p className="py-16 text-center text-sm text-muted-foreground">
          You don&apos;t have permission to change speed or share limits.
        </p>
      </>
    );
  }

  if (count === 0) {
    return (
      <>
        <PageHeader title="Set Limits" />
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">No torrents selected.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => router.push('/torrents')}>
            Choose torrents
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title="Set Limits" subtitle={countLabel} />

      <div className="mt-3 pb-8">
        <GroupedSection title="Speed Limits">
          <SpeedLimitInput
            label="Download Limit"
            currentLimit={limits.dl_limit ?? 0}
            mixed={limits.dl_limit === null}
            target={countLabel}
            onSave={saveLimit('setDownloadLimit', 'dl_limit')}
          />
          <SpeedLimitInput
            label="Upload Limit"
            currentLimit={limits.up_limit ?? 0}
            mixed={limits.up_limit === null}
            target={countLabel}
            onSave={saveLimit('setUploadLimit', 'up_limit')}
          />
        </GroupedSection>

        <ShareLimitsSection values={shareLimits} target={countLabel} onSave={saveShareLimits} />

        <GroupedSection title={count === 1 ? 'Torrent' : 'Torrents'}>
          {targets.slice(0, SHOWN_NAMES).map((target) => (
            <div key={target.hash} className="grouped-row">
              <span className="text-sm truncate min-w-0">{target.name}</span>
            </div>
          ))}
          {count > SHOWN_NAMES && (
            <div className="grouped-row">
              <span className="text-sm text-muted-foreground">and {count - SHOWN_NAMES} more</span>
            </div>
          )}
        </GroupedSection>
      </div>
    </div>
  );
}
