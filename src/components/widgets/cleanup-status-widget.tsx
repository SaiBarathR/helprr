'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatDistanceToNowShort } from '@/lib/format';
import { formatDelta } from '@/lib/cleanup/format-delta';
import type { WidgetProps } from '@/lib/widgets/types';
import type { AutoRunMode } from '@/lib/cleanup/types';
import { FONT_DISPLAY, FONT_MONO, HPR, Pill, SectionHeader, mix } from './bento-primitives';

interface SchedulerLeg {
  autoRunMode: AutoRunMode;
  intervalMinutes: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  running: boolean;
}

interface CleanupStats {
  removedToday: number;
  removedThisWeek: number;
  removedAllTime: number;
  activeStrikes: number;
  totalStrikes: number;
  reSearchedAllTime: number;
}

interface StrikeRow {
  id: string;
  torrentName: string;
  strikeType: string;
  ruleName: string | null;
  count: number;
  maxStrikes: number;
  lastSeenAt: string;
}

interface CleanupStatusData {
  scheduler: { queue: SchedulerLeg; download: SchedulerLeg } | null;
  strikes: StrikeRow[];
  stats: CleanupStats | null;
}

async function fetchCleanupStatus(): Promise<CleanupStatusData> {
  const [schedRes, strikesRes, statsRes] = await Promise.all([
    fetch('/api/cleanup/scheduler-status'),
    fetch('/api/cleanup/strikes'),
    fetch('/api/cleanup/stats'),
  ]);
  return {
    scheduler: schedRes.ok ? await schedRes.json() : null,
    strikes: strikesRes.ok ? await strikesRes.json() : [],
    stats: statsRes.ok ? await statsRes.json() : null,
  };
}

export function CleanupStatusWidget({ refreshInterval, editMode = false }: WidgetProps) {
  const { data } = useWidgetData({
    fetchFn: fetchCleanupStatus,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'cleanup-status',
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (editMode) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [editMode]);

  const stats = data?.stats;
  const strikes = data?.strikes ?? [];
  const queue = data?.scheduler?.queue;
  const download = data?.scheduler?.download;
  const dryRun = queue?.autoRunMode === 'dryRun' || download?.autoRunMode === 'dryRun';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SectionHeader
        title="Cleanup"
        badge={dryRun ? <Pill color={HPR.amber}>DRY</Pill> : null}
        right={
          <Link href="/cleanup" style={{ color: 'inherit', textDecoration: 'none' }}>
            View all →
          </Link>
        }
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr 1fr',
          gap: 6,
          marginBottom: 8,
        }}
      >
        <CleanupTile label="Today" value={stats?.removedToday} color={HPR.fgMute} />
        <CleanupTile label="Past 7d" value={stats?.removedThisWeek} color={HPR.green} />
        <CleanupTile label="Strikes" value={stats?.totalStrikes} color={HPR.amber} />
        <CleanupTile label="Re-search" value={stats?.reSearchedAllTime} color={HPR.fgMute} />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <CleanerRow label="Queue" leg={queue} now={now} color={HPR.amber} />
        <CleanerRow label="Download" leg={download} now={now} color={HPR.blue} />
      </div>

      <div style={{ fontSize: 10, color: HPR.fgSubtle, marginTop: 4, marginBottom: 6, fontFamily: FONT_MONO, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Active strikes ({strikes.length})
      </div>
      {strikes.length === 0 ? (
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '4px 0' }}>
          No active strikes
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            flex: '1 1 0',
            minHeight: 0,
            overflowY: 'auto',
            paddingRight: 2,
          }}
        >
          {strikes.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                background: HPR.ink,
                border: `1px solid ${HPR.hairline}`,
                borderRadius: 6,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: HPR.fg,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.torrentName}
                </div>
                <div style={{ fontSize: 9, color: HPR.fgMute, fontFamily: FONT_MONO }}>
                  {s.strikeType}
                  {s.ruleName ? ` · ${s.ruleName}` : ''}
                  {' · '}
                  {formatDistanceToNowShort(s.lastSeenAt)}
                </div>
              </div>
              <Pill color={s.count >= s.maxStrikes ? HPR.rose : HPR.amber}>
                {s.count}/{s.maxStrikes}
              </Pill>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CleanupTile({
  label,
  value,
  color,
}: {
  label: string;
  value?: number;
  color: string;
}) {
  return (
    <div
      style={{
        padding: 8,
        background: HPR.ink,
        border: `1px solid ${HPR.hairline}`,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 17,
          color,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}
      >
        {value ?? '—'}
      </div>
      <div
        style={{
          fontSize: 9,
          color: HPR.fgMute,
          marginTop: 4,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontFamily: FONT_MONO,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function CleanerRow({
  label,
  leg,
  now,
  color,
}: {
  label: string;
  leg?: SchedulerLeg;
  now: number;
  color: string;
}) {
  let text = '—';
  if (leg) {
    if (leg.autoRunMode === 'disabled') text = 'OFF';
    else if (leg.running) text = 'RUNNING…';
    else if (leg.nextRunAt != null) text = formatDelta(leg.nextRunAt - now);
    else text = 'IDLE';
  }
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 9px',
        background: HPR.ink,
        border: `1px solid ${HPR.hairline}`,
        borderRadius: 6,
      }}
    >
      <span style={{ fontSize: 11, color: HPR.fg }}>{label}</span>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          color,
          background: mix(color, 14),
          padding: '1px 6px',
          borderRadius: 4,
          fontWeight: 500,
        }}
      >
        {text}
      </span>
    </div>
  );
}
