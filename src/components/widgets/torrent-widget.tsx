'use client';

import Link from 'next/link';
import { HardDrive } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { formatBytes } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';
import type { QBittorrentSummaryResponse } from '@/types';
import { Eyebrow, FONT_DISPLAY, FONT_MONO, Hairline, HPR, ICON_HIDE_HEIGHT_THRESHOLD, ICON_HIDE_THRESHOLD, mix } from './bento-primitives';

const DOWNLOADING = new Set([
  'downloading', 'metadl', 'forcedmetadl', 'queueddl',
  'checkingdl', 'forceddl', 'allocating', 'stalleddl',
]);
const SEEDING = new Set(['uploading', 'stalledup', 'queuedup', 'checkingup', 'forcedup']);
const PAUSED = new Set(['paused', 'pauseddl', 'pausedup', 'stoppeddl', 'stoppedup']);

interface TorrentData {
  total: number;
  downloading: number;
  seeding: number;
  paused: number;
  dlSpeed: number;
  upSpeed: number;
  dlTotal: number;
  upTotal: number;
  dlRateLimit: number;
  upRateLimit: number;
}

async function fetchTorrentData(): Promise<TorrentData> {
  const res = await fetch('/api/qbittorrent/summary');
  if (!res.ok) throw new Error('Failed to fetch');
  const data: QBittorrentSummaryResponse = await res.json();
  const torrents = data.torrents || [];
  let downloading = 0,
    seeding = 0,
    paused = 0;
  for (const t of torrents) {
    const s = (t.state || '').toLowerCase();
    if (DOWNLOADING.has(s)) downloading++;
    else if (SEEDING.has(s)) seeding++;
    else if (PAUSED.has(s)) paused++;
  }
  const ti = data.transferInfo;
  return {
    total: torrents.length,
    downloading,
    seeding,
    paused,
    dlSpeed: ti?.dl_info_speed ?? 0,
    upSpeed: ti?.up_info_speed ?? 0,
    dlTotal: ti?.dl_info_data ?? 0,
    upTotal: ti?.up_info_data ?? 0,
    dlRateLimit: ti?.dl_rate_limit ?? 0,
    upRateLimit: ti?.up_rate_limit ?? 0,
  };
}

export function TorrentWidget({
  refreshInterval,
  editMode = false,
  narrow = false,
}: WidgetProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const compact = narrow;
  const hideIcon = width > 0 && height > 0 && (width < ICON_HIDE_THRESHOLD || height < ICON_HIDE_HEIGHT_THRESHOLD);
  const { data, loading } = useWidgetData({
    fetchFn: fetchTorrentData,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'torrent-overview',
  });

  const total = data?.total ?? (loading ? '–' : 0);
  const dl = data?.dlSpeed != null ? `${formatBytes(data.dlSpeed)}/s` : '–';
  const up = data?.upSpeed != null ? `${formatBytes(data.upSpeed)}/s` : '–';
  const dlT = data?.dlTotal != null ? formatBytes(data.dlTotal) : '–';
  const upT = data?.upTotal != null ? formatBytes(data.upTotal) : '–';

  const inner = (
    <div ref={ref} style={{ minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: hideIcon ? 5 : 10,
          minWidth: 0,
        }}
      >
        {!hideIcon && (
          <div
            style={{
              width: compact ? 28 : 32,
              height: compact ? 28 : 32,
              borderRadius: 7,
              background: mix(HPR.blue, 12),
              color: HPR.blue,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <HardDrive size={compact ? 12 : 14} />
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: compact ? 20 : 24,
              color: HPR.fg,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '-0.025em',
            }}
          >
            {total}
          </span>
          <Eyebrow>
            <span className="@max-[159px]/cell:hidden">torrent</span>
          </Eyebrow>
        </div>
        {data && (
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              gap: 6,
              fontFamily: FONT_MONO,
              fontSize: 9,
              color: HPR.fgMute,
            }}
          >
            <span style={{ color: HPR.blue }}>↓ {data.downloading} {!compact ? 'DL' : ''}</span>
            <span>↑ {data.seeding} {!compact ? 'SEED' : ''}</span>
          </div>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: compact ? 'column' : 'row',
          gap: compact ? 2 : 14,
          marginBottom: compact ? 8 : 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ color: HPR.blue, fontSize: 11 }}>↓</span>
            <span
              style={{
                fontFamily: FONT_MONO,
                color: HPR.fg,
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {dl}
            </span>
            {compact && (
              <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: HPR.fgSubtle, marginLeft: 'auto' }}>
                {dlT}
              </span>
            )}
          </div>
          {!compact && (
            <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: HPR.fgSubtle, marginTop: 1 }}>
              {dlT} total
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ color: HPR.green, fontSize: 11 }}>↑</span>
            <span
              style={{
                fontFamily: FONT_MONO,
                color: HPR.fg,
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {up}
            </span>
            {compact && (
              <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: HPR.fgSubtle, marginLeft: 'auto' }}>
                {upT}
              </span>
            )}
          </div>
          {!compact && (
            <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: HPR.fgSubtle, marginTop: 1 }}>
              {upT} total
            </div>
          )}
        </div>
      </div>
      {!compact && data && (data.dlRateLimit > 0 || data.upRateLimit > 0) && (
        <>
          <Hairline style={{ marginBottom: 7 }} />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
              color: HPR.fgMute,
            }}
          >
            <span style={{ color: HPR.amber }}>◐</span>
            <Eyebrow>Limits</Eyebrow>
            <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO }}>
              ↓ {formatBytes(data.dlRateLimit)}/s · ↑ {formatBytes(data.upRateLimit)}/s
            </span>
          </div>
        </>
      )}
    </div>
  );

  if (editMode) return inner;

  return (
    <Link href="/torrents" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      {inner}
    </Link>
  );
}
