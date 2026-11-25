'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { GroupedSection } from '@/components/settings/grouped-section';
import { ErrorState } from '@/components/ui/error-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/components/permission-provider';
import type { QBittorrentTorrent } from '@/types';
import { SpeedLimitInput } from '../../_components/speed-limit-input';
import { ShareLimitsSection, type ShareLimitValues } from '../../_components/share-limits-section';
import { TorrentLocationSection, TorrentQueueSection, TorrentTagsSection } from '../../_components/torrent-organize-sections';
import { parseTorrentTags } from '../../_components/torrent-tags';
import { torrentQueryKey, useTorrent, useTorrentAction } from '../../_components/use-torrent';
import { useQbitInstance } from '../../_components/use-qbit-instance';

type TorrentOption = 'seq_dl' | 'f_l_piece_prio' | 'auto_tmm';

// qBittorrent exposes sequential download and first/last piece priority only
// as toggles; automatic management takes the target value.
const OPTIONS: {
  field: TorrentOption;
  label: string;
  success: string;
  body: (enable: boolean) => Record<string, unknown>;
}[] = [
  { field: 'seq_dl', label: 'Sequential Download', success: 'Sequential download toggled', body: () => ({ action: 'toggleSequentialDownload' }) },
  { field: 'f_l_piece_prio', label: 'First/Last Piece Priority', success: 'First/last piece priority toggled', body: () => ({ action: 'toggleFirstLastPiecePrio' }) },
  { field: 'auto_tmm', label: 'Auto Torrent Management', success: 'Auto management toggled', body: (enable) => ({ action: 'setAutoManagement', enable }) },
];

export default function TorrentSettingsPage() {
  const { hash } = useParams<{ hash: string }>();
  const queryClient = useQueryClient();
  const { instanceId } = useQbitInstance();
  const canBandwidth = useCan('torrents.bandwidth');
  const canManage = useCan('torrents.manage');
  const [pendingOptions, setPendingOptions] = useState<ReadonlySet<TorrentOption>>(() => new Set());

  const torrentQuery = useTorrent(hash);
  const torrent = torrentQuery.data;
  const runAction = useTorrentAction();

  const setTorrentField = <K extends keyof QBittorrentTorrent>(field: K, value: QBittorrentTorrent[K]) => {
    queryClient.setQueryData<QBittorrentTorrent | null>(
      torrentQueryKey(hash, instanceId),
      (old) => (old ? { ...old, [field]: value } : old),
    );
  };

  const saveLimit = (action: 'setDownloadLimit' | 'setUploadLimit', field: 'dl_limit' | 'up_limit') =>
    async (limit: number) => {
      const ok = await runAction({ hash, action, limit });
      if (ok) setTorrentField(field, limit);
      return ok;
    };

  const saveShareLimits = async (limits: ShareLimitValues) => {
    const ok = await runAction({
      hash,
      action: 'setShareLimits',
      ratioLimit: limits.ratio_limit,
      seedingTimeLimit: limits.seeding_time_limit,
      inactiveSeedingTimeLimit: limits.inactive_seeding_time_limit,
    });
    if (ok) {
      for (const field of Object.keys(limits) as (keyof ShareLimitValues)[]) setTorrentField(field, limits[field]);
      // The limits in force (max_*) follow from these and the global ones.
      void torrentQuery.refetch();
    }
    return ok;
  };

  // Optimistic: the switch moves at once and rolls back if qBittorrent refuses.
  // It stays disabled while in flight, so a toggle action can't be sent twice.
  const toggleOption = async (option: (typeof OPTIONS)[number], enable: boolean) => {
    setPendingOptions((prev) => new Set(prev).add(option.field));
    setTorrentField(option.field, enable);
    const ok = await runAction({ hash, ...option.body(enable) });
    if (ok) toast.success(option.success);
    else setTorrentField(option.field, !enable);
    setPendingOptions((prev) => {
      const next = new Set(prev);
      next.delete(option.field);
      return next;
    });
  };

  if (torrentQuery.isLoading) {
    return <><PageHeader title="Torrent Settings" /><PageSpinner /></>;
  }

  if (!torrent) {
    return (
      <>
        <PageHeader title="Torrent Settings" />
        {torrentQuery.isError ? (
          <ErrorState
            message="Failed to load the torrent."
            onRetry={() => void torrentQuery.refetch()}
            retrying={torrentQuery.isFetching}
          />
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">
            This torrent is no longer in qBittorrent.
          </p>
        )}
      </>
    );
  }

  const tags = parseTorrentTags(torrent.tags);

  return (
    <div className="animate-content-in">
      <PageHeader title="Torrent Settings" subtitle={torrent.name} />

      <div className="mt-3 pb-8">
        {canBandwidth && (
          <GroupedSection title="Speed Limits">
            <SpeedLimitInput
              label="Download Limit"
              currentLimit={torrent.dl_limit}
              onSave={saveLimit('setDownloadLimit', 'dl_limit')}
            />
            <SpeedLimitInput
              label="Upload Limit"
              currentLimit={torrent.up_limit}
              onSave={saveLimit('setUploadLimit', 'up_limit')}
            />
          </GroupedSection>
        )}

        <ShareLimitsSection
          values={{
            ratio_limit: torrent.ratio_limit ?? -2,
            seeding_time_limit: torrent.seeding_time_limit ?? -2,
            inactive_seeding_time_limit: torrent.inactive_seeding_time_limit ?? -2,
          }}
          effective={{
            ratio_limit: torrent.max_ratio,
            seeding_time_limit: torrent.max_seeding_time,
            inactive_seeding_time_limit: torrent.max_inactive_seeding_time,
          }}
          readOnly={!canBandwidth}
          onSave={saveShareLimits}
        />

        {canManage && (
          <GroupedSection title="Options">
            {OPTIONS.map((option) => (
              <div key={option.field} className="grouped-row">
                <span className="text-sm">{option.label}</span>
                <Switch
                  checked={torrent[option.field]}
                  disabled={pendingOptions.has(option.field)}
                  onCheckedChange={(checked) => void toggleOption(option, checked)}
                  aria-label={option.label}
                />
              </div>
            ))}
          </GroupedSection>
        )}

        {canManage && (
          <>
            <TorrentLocationSection
              hash={hash}
              savePath={torrent.save_path}
              onSaved={(location) => {
                setTorrentField('save_path', location);
                // qBittorrent turns automatic management off when it moves a torrent.
                setTorrentField('auto_tmm', false);
              }}
            />
            <TorrentTagsSection
              hash={hash}
              tagsByTorrent={[tags]}
              onChanged={(action, tag) => {
                const next = action === 'addTags' ? [...new Set([...tags, tag])] : tags.filter((t) => t !== tag);
                setTorrentField('tags', next.join(', '));
              }}
            />
            <TorrentQueueSection
              hash={hash}
              positions={[torrent.priority]}
              onMoved={() => void torrentQuery.refetch()}
            />
          </>
        )}

        {!canBandwidth && !canManage && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            You don&apos;t have permission to change torrent settings.
          </p>
        )}
      </div>
    </div>
  );
}
