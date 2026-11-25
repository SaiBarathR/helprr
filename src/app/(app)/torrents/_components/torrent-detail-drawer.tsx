'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Copy, Download, FolderOpen, Hash, Loader2, Pencil, SlidersHorizontal, Users } from 'lucide-react';
import type { QBittorrentTorrent } from '@/types';
import type { TorrentFile, TorrentTracker } from '@/lib/qbittorrent-client';
import { formatSpeedLimit } from './speed-limit-input';
import { formatShareLimit } from './share-limits-section';
import { realTrackers, trackerCount, trackerStatusLabel } from './torrent-trackers';
import { formatBytes, formatEta, formatSeedingTime, formatSpeed, torrentSizeUnknown } from './torrent-list';
import { formatDateTime } from '@/lib/date-format';
import { useMe } from '@/components/permission-provider';
import { withInstanceQuery } from '@/lib/query-fetch';
import { saveFile } from '@/lib/save-file';
import { filenameFromDisposition } from '@/lib/torrent-export-name';

export interface TorrentDetailData {
  properties: Record<string, unknown>;
  files: TorrentFile[];
  /** Hosts only, without the announce path or query, unless the user is an admin. */
  trackers: TorrentTracker[];
  /** The magnet to copy, built on the server: without `tr=` unless the user is an admin. */
  magnet: string | null;
  /** Whether the torrent is private (null when qBittorrent doesn't say). */
  private?: boolean | null;
}

async function copyText(text: string, what: string) {
  try {
    // Throws outside a secure context too (Helprr over plain http), where there is no clipboard API.
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error('Failed to copy');
  }
}

/** Downloads the torrent's .torrent file (admins only, on the server too). */
async function exportTorrent(hash: string, instanceId: string | undefined) {
  const toastId = toast.loading('Exporting .torrent…');
  try {
    const res = await fetch(withInstanceQuery(`/api/qbittorrent/${hash}/export`, instanceId), { cache: 'no-store' });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(payload?.error || 'Failed to export the torrent', { id: toastId });
      return;
    }
    const filename = filenameFromDisposition(res.headers.get('content-disposition'), `${hash}.torrent`);
    toast.dismiss(toastId);
    await saveFile(await res.blob(), filename);
  } catch {
    toast.error('Failed to export the torrent', { id: toastId });
  }
}

/** One torrent's details: transfer, session, settings (read-only), timing, network, torrent info, magnet, files and trackers (read-only). */
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
  instanceId,
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
  /** The qBittorrent the torrent is in (undefined: the default one). */
  instanceId: string | undefined;
  router: { push: (href: string) => void };
}) {
  // The .torrent carries the full tracker URLs, which only an admin sees.
  const canExport = useMe()?.role === 'admin';
  const trackers = detailData ? realTrackers(detailData.trackers) : [];
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
                    <DetailRow label="Remaining" value={torrentSizeUnknown({ total_size: detailTorrent.total_size ?? Number(detailData.properties.total_size) }) ? '—' : formatBytes(detailTorrent.amount_left || 0)} />
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
                      <DetailRow label="Ratio Limit" value={formatShareLimit('ratio', detailTorrent.ratio_limit ?? -2, detailTorrent.max_ratio)} />
                      <DetailRow label="Seeding Time Limit" value={formatShareLimit('time', detailTorrent.seeding_time_limit ?? -2, detailTorrent.max_seeding_time)} />
                      <DetailRow label="Inactive Seeding Limit" value={formatShareLimit('time', detailTorrent.inactive_seeding_time_limit ?? -2, detailTorrent.max_inactive_seeding_time)} />
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
                    <DetailRow label="Added" value={formatDateTime(Number(detailData.properties.addition_date) * 1000)} />
                  )}
                  {Number(detailData.properties.completion_date) > 0 && (
                    <DetailRow label="Completed" value={formatDateTime(Number(detailData.properties.completion_date) * 1000)} />
                  )}
                  <DetailRow label="Seeding Time" value={formatSeedingTime(Number(detailData.properties.seeding_time) || 0)} />
                  <DetailRow label="Time Elapsed" value={formatSeedingTime(Number(detailData.properties.time_elapsed) || 0)} />
                  {detailTorrent && detailTorrent.eta > 0 && detailTorrent.eta < 8640000 && (
                    <DetailRow label="ETA" value={formatEta(detailTorrent.eta)} />
                  )}
                  {/* qBittorrent reports -1 or 0 when no peer has had the whole torrent, or no announce is due (stopped). */}
                  {Number(detailData.properties.last_seen) > 0 && (
                    <DetailRow label="Last Seen Complete" value={formatDateTime(Number(detailData.properties.last_seen) * 1000)} />
                  )}
                  {Number(detailData.properties.reannounce) > 0 && (
                    <DetailRow label="Next Reannounce" value={formatEta(Number(detailData.properties.reannounce))} />
                  )}
                </div>
              </div>

              {/* Network */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Network</h3>
                  <button
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                    onClick={() => {
                      const name = detailHash ? torrentNameByHash.get(detailHash) || '' : '';
                      setDetailHash(null);
                      setDetailData(null);
                      router.push(`/torrents/${detailHash}/peers?name=${encodeURIComponent(name)}`);
                    }}
                  >
                    <Users className="h-3.5 w-3.5" />
                    {canManageTorrents ? 'Manage Peers' : 'View Peers'}
                  </button>
                </div>
                <div className="rounded-lg border divide-y">
                  <DetailRow label="Seeds" value={`${detailData.properties.seeds} (${detailData.properties.seeds_total} total)`} />
                  <DetailRow label="Peers" value={`${detailData.properties.peers} (${detailData.properties.peers_total} total)`} />
                  <DetailRow label="Connections" value={String(detailData.properties.nb_connections || 0)} />
                  <DetailRow label="Wasted" value={formatBytes(Number(detailData.properties.total_wasted) || 0)} />
                  <DetailRow label="Save Path" value={String(detailData.properties.save_path || '-')} />
                </div>
              </div>

              {/* Torrent: what it is, from its metadata. The comment and "created by" come
                  cleaned for anyone but an admin (a tracker can put a passkey link there). */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Torrent</h3>
                <div className="rounded-lg border divide-y">
                  {detailHash && <DetailRow label="Hash" value={detailHash} mono />}
                  {typeof detailData.private === 'boolean' && (
                    <DetailRow label="Private" value={detailData.private ? 'Yes' : 'No'} />
                  )}
                  {/* -1 until the torrent has its metadata. */}
                  {Number(detailData.properties.pieces_num) > 0 && (
                    <DetailRow
                      label="Pieces"
                      value={`${Number(detailData.properties.pieces_have) || 0} / ${Number(detailData.properties.pieces_num)} × ${formatBytes(Number(detailData.properties.piece_size))}`}
                    />
                  )}
                  {Number(detailData.properties.creation_date) > 0 && (
                    <DetailRow label="Created On" value={formatDateTime(Number(detailData.properties.creation_date) * 1000)} />
                  )}
                  {typeof detailData.properties.created_by === 'string' && detailData.properties.created_by && (
                    <DetailRow label="Created By" value={detailData.properties.created_by} />
                  )}
                  {typeof detailData.properties.comment === 'string' && detailData.properties.comment && (
                    <div className="px-3 py-2 space-y-0.5">
                      <p className="text-xs text-muted-foreground">Comment</p>
                      <p className="text-xs whitespace-pre-wrap break-words">{detailData.properties.comment}</p>
                    </div>
                  )}
                </div>
                {detailHash && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      disabled={!torrentNameByHash.get(detailHash)}
                      onClick={() => void copyText(torrentNameByHash.get(detailHash) || '', 'Name')}
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Copy Name
                    </Button>
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => void copyText(detailHash, 'Hash')}>
                      <Hash className="mr-2 h-3.5 w-3.5" />
                      Copy Hash
                    </Button>
                    {canExport && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="col-span-2 text-xs"
                        onClick={() => void exportTorrent(detailHash, instanceId)}
                      >
                        <Download className="mr-2 h-3.5 w-3.5" />
                        Export .torrent
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Magnet Link */}
              {detailData.magnet && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Magnet Link</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => {
                      if (!detailData.magnet) return;
                      void copyText(detailData.magnet, 'Magnet URI');
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

              {/* Trackers: edited on their own page, as the settings are. */}
              {(trackers.length > 0 || canManageTorrents) && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Trackers ({trackers.length})
                    </h3>
                    {canManageTorrents && (
                      <button
                        className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        onClick={() => {
                          const name = detailHash ? torrentNameByHash.get(detailHash) || '' : '';
                          setDetailHash(null);
                          setDetailData(null);
                          router.push(`/torrents/${detailHash}/trackers?name=${encodeURIComponent(name)}`);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Manage Trackers
                      </button>
                    )}
                  </div>
                  <div className="rounded-lg border divide-y">
                    {trackers.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No trackers</p>}
                    {trackers.map((tracker, i) => (
                      <div key={i} className="px-3 py-2 space-y-0.5">
                        <p className="text-xs break-all">{tracker.url}</p>
                        <p className="text-[10px] text-muted-foreground break-words">
                          {trackerStatusLabel(tracker.status)} &middot; Tier {tracker.tier} &middot; Seeds:{' '}
                          {trackerCount(tracker.num_seeds)} &middot; Leechers: {trackerCount(tracker.num_leeches)}
                          {tracker.msg && ` · ${tracker.msg}`}
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

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs text-right max-w-[60%] ${mono ? 'font-mono break-all' : 'break-words'}`}>{value}</span>
    </div>
  );
}
