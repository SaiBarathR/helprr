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
import { torrentQueryKey, useTorrent, useTorrentAction } from '../../_components/use-torrent';

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
  const canBandwidth = useCan('torrents.bandwidth');
  const canManage = useCan('torrents.manage');
  const [pendingOptions, setPendingOptions] = useState<ReadonlySet<TorrentOption>>(() => new Set());

  const torrentQuery = useTorrent(hash);
  const torrent = torrentQuery.data;
  const runAction = useTorrentAction();

  const setTorrentField = <K extends keyof QBittorrentTorrent>(field: K, value: QBittorrentTorrent[K]) => {
    queryClient.setQueryData<QBittorrentTorrent | null>(
      torrentQueryKey(hash),
      (old) => (old ? { ...old, [field]: value } : old),
    );
  };

  const saveLimit = (action: 'setDownloadLimit' | 'setUploadLimit', field: 'dl_limit' | 'up_limit') =>
    async (limit: number) => {
      const ok = await runAction({ hash, action, limit });
      if (ok) setTorrentField(field, limit);
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

        {!canBandwidth && !canManage && (
          <p className="py-16 text-center text-sm text-muted-foreground">
            You don&apos;t have permission to change torrent settings.
          </p>
        )}
      </div>
    </div>
  );
}
