'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronRight, Loader2 } from 'lucide-react';
import Link from '@/components/ui/app-link';
import { PageHeader } from '@/components/layout/page-header';
import { GroupedSection } from '@/components/settings/grouped-section';
import { ErrorState } from '@/components/ui/error-state';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError, backoffRefetchInterval, jsonFetcher } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import { formatBytes } from '@/lib/format';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { useUIStore, type TorrentsViewPreference } from '@/lib/store';
import { useCan, useMe } from '@/components/permission-provider';
import type { QBittorrentServerStats, QBittorrentTransferInfo } from '@/types';
import { SpeedLimitInput, formatSpeedLimit } from '../_components/speed-limit-input';

interface TransferLimits {
  downloadLimit: number;
  uploadLimit: number;
  altDownloadLimit: number;
  altUploadLimit: number;
  speedLimitsMode: number;
}

type LimitAction = 'setDownloadLimit' | 'setUploadLimit' | 'setAltDownloadLimit' | 'setAltUploadLimit';
type LimitField = 'downloadLimit' | 'uploadLimit' | 'altDownloadLimit' | 'altUploadLimit';

const LIMITS_URL = '/api/qbittorrent/transfer/limits';
const LIMITS_KEY = ['qbittorrent', 'transfer', 'limits'] as const;

async function postTransferLimits(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(LIMITS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // ApiError so a 401 reaches the global MutationCache handler (redirect).
  if (!res.ok) throw new ApiError(res.status, 'Failed to update qBittorrent settings');
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grouped-row">
      <span className="text-sm">{label}</span>
      <span className="text-sm text-muted-foreground text-right break-words min-w-0 ml-4">{value}</span>
    </div>
  );
}

export default function QBittorrentSettingsPage() {
  const queryClient = useQueryClient();
  const canBandwidth = useCan('torrents.bandwidth');
  const isAdmin = useMe()?.role === 'admin';
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const viewMode = useUIStore((s) => s.torrentsView);
  const setViewMode = useUIStore((s) => s.setTorrentsView);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);

  useEffect(() => {
    async function loadRefreshInterval() {
      setRefreshIntervalMs(await getRefreshIntervalMs('torrentsRefreshIntervalSecs', 5));
    }
    loadRefreshInterval();
  }, []);

  const limitsQuery = useQuery({
    queryKey: LIMITS_KEY,
    queryFn: jsonFetcher<TransferLimits>(LIMITS_URL),
    // The bandwidth scheduler changes these on its own; read fresh on each visit.
    staleTime: 0,
  });
  const limits = limitsQuery.data;

  const transferQuery = useQuery({
    queryKey: ['qbittorrent', 'transfer'],
    queryFn: jsonFetcher<QBittorrentTransferInfo>('/api/qbittorrent/transfer'),
    staleTime: 0,
    refetchInterval: backoffRefetchInterval(refreshIntervalMs),
    refetchIntervalInBackground: false,
  });
  const transfer = transferQuery.data;

  // A full sync/maindata read upstream, cached briefly on the server; free space
  // and all-time totals change slowly, so this polls less often than transfer.
  const statsQuery = useQuery({
    queryKey: ['qbittorrent', 'transfer', 'stats'],
    queryFn: jsonFetcher<QBittorrentServerStats>('/api/qbittorrent/transfer/stats'),
    staleTime: 0,
    refetchInterval: backoffRefetchInterval(Math.max(refreshIntervalMs, 30_000)),
    refetchIntervalInBackground: false,
  });
  const stats = statsQuery.data;
  const statValue = (value: number | null | undefined, format: (value: number) => string) =>
    stats ? (value == null ? 'Unknown' : format(value)) : statsQuery.isError ? 'Unavailable' : '…';

  const { mutateAsync: postLimits } = useMutation({ mutationFn: postTransferLimits });

  const saveLimit = (action: LimitAction, field: LimitField) =>
    async (limit: number) => {
      // A rejection is toasted by SpeedLimitInput.
      await postLimits({ action, limit });
      queryClient.setQueryData<TransferLimits>(LIMITS_KEY, (old) => (old ? { ...old, [field]: limit } : old));
    };

  // Bumped per toggle, so only the latest toggle's confirmation writes.
  const speedModeToggle = useRef(0);

  // qBittorrent may apply the switch asynchronously: an immediate re-read can
  // still show the old mode. Keep the optimistic mode until a read confirms it.
  // If it never confirms, show what qBittorrent reports rather than leave the
  // switch stuck on a mode it doesn't have. Only the mode is taken from the
  // read: the limits don't depend on it, and a limit saved meanwhile may be
  // newer than this read.
  const confirmSpeedMode = async (mode: number, toggle: number) => {
    let fresh: TransferLimits | undefined;
    for (let attempt = 0; attempt < 5 && fresh?.speedLimitsMode !== mode; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (toggle !== speedModeToggle.current) return;
      try {
        fresh = await jsonFetcher<TransferLimits>(LIMITS_URL)();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          handleAuthError(error);
          return;
        }
        // A failed read proves nothing either way; try again.
      }
    }
    if (!fresh || toggle !== speedModeToggle.current) return;
    const { speedLimitsMode } = fresh;
    queryClient.setQueryData<TransferLimits>(LIMITS_KEY, (old) => (old ? { ...old, speedLimitsMode } : fresh));
  };

  const speedModeMutation = useMutation({
    mutationFn: () => postTransferLimits({ action: 'toggleSpeedLimitsMode' }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: LIMITS_KEY });
      const previous = queryClient.getQueryData<TransferLimits>(LIMITS_KEY);
      const mode = previous?.speedLimitsMode === 1 ? 0 : 1;
      queryClient.setQueryData<TransferLimits>(LIMITS_KEY, (old) => (old ? { ...old, speedLimitsMode: mode } : old));
      return { previous, mode, toggle: ++speedModeToggle.current };
    },
    onSuccess: (_data, _vars, context) => {
      toast.success('Alternative speed mode toggled');
      void confirmSpeedMode(context.mode, context.toggle);
    },
    onError: (err, _vars, context) => {
      // Restore only the mode: a limit saved meanwhile must survive the rollback.
      if (context?.previous) {
        const { speedLimitsMode } = context.previous;
        queryClient.setQueryData<TransferLimits>(LIMITS_KEY, (old) => (old ? { ...old, speedLimitsMode } : old));
      }
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error('Failed to toggle speed mode');
    },
  });

  return (
    <div className="animate-content-in">
      {/* The bar spans the page; its back button and title line up with the settings column. */}
      <PageHeader title="qBittorrent Settings" className="*:readable-column" />

      <div className="mt-3 pb-8 readable-column">
        <GroupedSection title="View" footer="Automatic shows the table on wide screens and cards on phones.">
          <div className="grouped-row">
            <span className="text-sm">Layout</span>
            <Select
              value={viewMode}
              onValueChange={(v) => setViewMode(v as TorrentsViewPreference)}
              disabled={!hasHydrated}
            >
              <SelectTrigger aria-label="Layout" className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatic</SelectItem>
                <SelectItem value="card">Cards</SelectItem>
                <SelectItem value="table">Table</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </GroupedSection>

        <GroupedSection title="Organize">
          <Link
            href="/torrents/categories"
            className="grouped-row hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
          >
            <span className="text-sm">Categories</span>
            <span className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
              {isAdmin ? 'Add, edit and remove' : 'Folders and names'}
              <ChevronRight className="h-4 w-4" />
            </span>
          </Link>
        </GroupedSection>

        <GroupedSection
          title="Speed Limits"
          footer="qBittorrent uses the alternative limits while Alternative Speed Limits is on. Bandwidth rules in Settings → Downloads change only the global limits."
        >
          {limitsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !limits ? (
            <ErrorState
              compact
              message="Failed to load speed limits."
              onRetry={() => void limitsQuery.refetch()}
              retrying={limitsQuery.isFetching}
            />
          ) : canBandwidth ? (
            <>
              <SpeedLimitInput
                label="Global Download Limit"
                currentLimit={limits.downloadLimit}
                onSave={saveLimit('setDownloadLimit', 'downloadLimit')}
              />
              <SpeedLimitInput
                label="Global Upload Limit"
                currentLimit={limits.uploadLimit}
                onSave={saveLimit('setUploadLimit', 'uploadLimit')}
              />
              <div className="grouped-row">
                <span className="text-sm">Alternative Speed Limits</span>
                <Switch
                  checked={limits.speedLimitsMode === 1}
                  disabled={speedModeMutation.isPending}
                  onCheckedChange={() => speedModeMutation.mutate()}
                  aria-label="Alternative Speed Limits"
                />
              </div>
              <SpeedLimitInput
                label="Alternative Download Limit"
                currentLimit={limits.altDownloadLimit}
                onSave={saveLimit('setAltDownloadLimit', 'altDownloadLimit')}
              />
              <SpeedLimitInput
                label="Alternative Upload Limit"
                currentLimit={limits.altUploadLimit}
                onSave={saveLimit('setAltUploadLimit', 'altUploadLimit')}
              />
            </>
          ) : (
            <>
              <StatRow label="Global Download Limit" value={formatSpeedLimit(limits.downloadLimit)} />
              <StatRow label="Global Upload Limit" value={formatSpeedLimit(limits.uploadLimit)} />
              <StatRow label="Alternative Speed Limits" value={limits.speedLimitsMode === 1 ? 'On' : 'Off'} />
              <StatRow label="Alternative Download Limit" value={formatSpeedLimit(limits.altDownloadLimit)} />
              <StatRow label="Alternative Upload Limit" value={formatSpeedLimit(limits.altUploadLimit)} />
            </>
          )}
        </GroupedSection>

        <GroupedSection title="Transfer Stats">
          {transfer ? (
            <>
              <StatRow label="Free Disk Space" value={statValue(stats?.freeSpaceOnDisk, formatBytes)} />
              <StatRow label="Session Downloaded" value={formatBytes(transfer.dl_info_data)} />
              <StatRow label="Session Uploaded" value={formatBytes(transfer.up_info_data)} />
              <StatRow label="All-time Downloaded" value={statValue(stats?.alltimeDownloaded, formatBytes)} />
              <StatRow label="All-time Uploaded" value={statValue(stats?.alltimeUploaded, formatBytes)} />
              <StatRow label="Global Ratio" value={statValue(stats?.globalRatio, (ratio) => ratio.toFixed(2))} />
              <StatRow label="DHT Nodes" value={String(transfer.dht_nodes)} />
              <StatRow label="Connection Status" value={transfer.connection_status} />
            </>
          ) : transferQuery.isError ? (
            <ErrorState
              compact
              message="Failed to load transfer stats."
              onRetry={() => void transferQuery.refetch()}
              retrying={transferQuery.isFetching}
            />
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </GroupedSection>
      </div>
    </div>
  );
}
