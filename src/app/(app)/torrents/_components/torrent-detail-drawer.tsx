'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Copy, FolderOpen, Loader2, SlidersHorizontal } from 'lucide-react';
import type { QBittorrentTorrent } from '@/types';
import type { TorrentFile, TorrentTracker } from '@/lib/qbittorrent-client';
import { formatSpeedLimit } from './speed-limit-input';
import { formatBytes, formatEta, formatSeedingTime, formatSpeed } from './torrent-list';

export interface TorrentDetailData {
  properties: Record<string, unknown>;
  files: TorrentFile[];
  trackers: TorrentTracker[];
}

/** One torrent's details: transfer, session, settings (read-only), timing, network, magnet, files and trackers. */
export function TorrentDetailDrawer({
  detailHash,
  setDetailHash,
  setDetailData,
  torrentNameByHash,
  detailLoading,
  detailData,
  detailTorrent,
  canBandwidthTorrents,
  canManageTorrents,
  router,
}: {
  detailHash: string | null;
  setDetailHash: (hash: string | null) => void;
  setDetailData: (data: TorrentDetailData | null) => void;
  torrentNameByHash: Map<string, string>;
  detailLoading: boolean;
  detailData: TorrentDetailData | null;
  detailTorrent: QBittorrentTorrent | null | undefined;
  canBandwidthTorrents: boolean;
  canManageTorrents: boolean;
  router: { push: (href: string) => void };
}) {
  return (
    <Drawer
      open={!!detailHash}
      onOpenChange={(open) => {
        if (!open) {
          setDetailHash(null);
          setDetailData(null);
        }
      }}
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-sm break-all leading-snug">
            {detailHash ? torrentNameByHash.get(detailHash) || 'Torrent Details' : 'Torrent Details'}
          </DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 flex-1 min-h-0 overflow-y-auto space-y-4">
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : detailData ? (
            <>
              {/* Transfer */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Transfer</h3>
                <div className="rounded-lg border divide-y">
                  <DetailRow label="Total Size" value={formatBytes(Number(detailData.properties.total_size) || 0)} />
                  <DetailRow label="Downloaded" value={formatBytes(Number(detailData.properties.total_downloaded) || 0)} />
                  <DetailRow label="Uploaded" value={formatBytes(Number(detailData.properties.total_uploaded) || 0)} />
                  {detailTorrent && detailTorrent.progress < 1 && (
                    <DetailRow label="Remaining" value={formatBytes(detailTorrent.amount_left || 0)} />
                  )}
                  <DetailRow label="Ratio" value={Number(detailData.properties.share_ratio || 0).toFixed(2)} />
                  {/* qBittorrent reports -1 when availability doesn't apply (e.g. seeding). */}
                  <DetailRow label="Availability" value={(detailTorrent?.availability ?? -1) >= 0 ? detailTorrent!.availability.toFixed(2) : '—'} />
                  {Number(detailData.properties.dl_speed) > 0 && (
                    <DetailRow label="DL Speed" value={formatSpeed(Number(detailData.properties.dl_speed))} />
                  )}
                  {Number(detailData.properties.up_speed) > 0 && (
                    <DetailRow label="UL Speed" value={formatSpeed(Number(detailData.properties.up_speed))} />
                  )}
                </div>
              </div>

              {/* Session Stats */}
              {detailTorrent && (detailTorrent.downloaded_session > 0 || detailTorrent.uploaded_session > 0) && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Session Stats</h3>
                  <div className="rounded-lg border divide-y">
                    <DetailRow label="Session Downloaded" value={formatBytes(detailTorrent.downloaded_session)} />
                    <DetailRow label="Session Uploaded" value={formatBytes(detailTorrent.uploaded_session)} />
                  </div>
                </div>
              )}

              {/* Settings: read-only here. Editing lives on its own page, where
                  the on-screen keyboard can't push a drawer out of view. */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Settings</h3>
                <div className="rounded-lg border divide-y">
                  <DetailRow label="Download Limit" value={formatSpeedLimit(Number(detailData.properties.dl_limit) || 0)} />
                  <DetailRow label="Upload Limit" value={formatSpeedLimit(Number(detailData.properties.up_limit) || 0)} />
                  {detailTorrent && (
                    <>
                      <DetailRow label="Sequential Download" value={detailTorrent.seq_dl ? 'On' : 'Off'} />
                      <DetailRow label="First/Last Piece Priority" value={detailTorrent.f_l_piece_prio ? 'On' : 'Off'} />
                      <DetailRow label="Auto Torrent Management" value={detailTorrent.auto_tmm ? 'On' : 'Off'} />
                    </>
                  )}
                </div>
                {detailHash && (canBandwidthTorrents || canManageTorrents) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs mt-2"
                    onClick={() => {
                      const hash = detailHash;
                      setDetailHash(null);
                      setDetailData(null);
                      router.push(`/torrents/${hash}/settings`);
                    }}
                  >
                    <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
                    Edit Settings
                  </Button>
                )}
              </div>

              {/* Timing */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Timing</h3>
                <div className="rounded-lg border divide-y">
                  {Number(detailData.properties.addition_date) > 0 && (
                    <DetailRow label="Added" value={new Date(Number(detailData.properties.addition_date) * 1000).toLocaleString()} />
                  )}
                  {Number(detailData.properties.completion_date) > 0 && (
                    <DetailRow label="Completed" value={new Date(Number(detailData.properties.completion_date) * 1000).toLocaleString()} />
                  )}
                  <DetailRow label="Seeding Time" value={formatSeedingTime(Number(detailData.properties.seeding_time) || 0)} />
                  <DetailRow label="Time Elapsed" value={formatSeedingTime(Number(detailData.properties.time_elapsed) || 0)} />
                  {detailTorrent && detailTorrent.eta > 0 && detailTorrent.eta < 8640000 && (
                    <DetailRow label="ETA" value={formatEta(detailTorrent.eta)} />
                  )}
                </div>
              </div>

              {/* Network */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Network</h3>
                <div className="rounded-lg border divide-y">
                  <DetailRow label="Seeds" value={`${detailData.properties.seeds} (${detailData.properties.seeds_total} total)`} />
                  <DetailRow label="Peers" value={`${detailData.properties.peers} (${detailData.properties.peers_total} total)`} />
                  <DetailRow label="Connections" value={String(detailData.properties.nb_connections || 0)} />
                  <DetailRow label="Wasted" value={formatBytes(Number(detailData.properties.total_wasted) || 0)} />
                  <DetailRow label="Save Path" value={String(detailData.properties.save_path || '-')} />
                </div>
              </div>

              {/* Magnet Link */}
              {detailTorrent?.magnet_uri && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Magnet Link</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(detailTorrent.magnet_uri).then(
                        () => toast.success('Magnet URI copied'),
                        () => toast.error('Failed to copy')
                      );
                    }}
                  >
                    <Copy className="mr-2 h-3.5 w-3.5" />
                    Copy Magnet URI
                  </Button>
                </div>
              )}

              {/* Files */}
              {detailData.files.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Files ({detailData.files.length})
                    </h3>
                    <button
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                      onClick={() => {
                        const name = detailHash ? torrentNameByHash.get(detailHash) || '' : '';
                        setDetailHash(null);
                        setDetailData(null);
                        router.push(`/torrents/${detailHash}/files?name=${encodeURIComponent(name)}`);
                      }}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Manage Files
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {detailData.files.slice(0, 5).map((file) => (
                      <div key={file.index} className="rounded-lg bg-muted/40 p-2.5 space-y-1">
                        <p className="text-xs font-medium break-all leading-snug">{file.name}</p>
                        <div className="flex items-center gap-2">
                          <Progress value={file.progress * 100} className="h-1 flex-1" />
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {(file.progress * 100).toFixed(0)}%
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{formatBytes(file.size)}</p>
                      </div>
                    ))}
                    {detailData.files.length > 5 && (
                      <p className="text-[10px] text-muted-foreground text-center py-1">
                        +{detailData.files.length - 5} more files
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Trackers */}
              {detailData.trackers.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Trackers ({detailData.trackers.filter((t) => t.url.startsWith('http')).length})
                  </h3>
                  <div className="rounded-lg border divide-y">
                    {detailData.trackers
                      .filter((t) => t.url.startsWith('http'))
                      .map((tracker, i) => (
                        <div key={i} className="px-3 py-2 space-y-0.5">
                          <p className="text-xs break-all">{tracker.url}</p>
                          <p className="text-[10px] text-muted-foreground">
                            Seeds: {tracker.num_seeds} &middot; Peers: {tracker.num_leeches}
                            {tracker.msg && ` &middot; ${tracker.msg}`}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-right max-w-[60%] break-words">{value}</span>
    </div>
  );
}
