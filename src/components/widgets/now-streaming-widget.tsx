'use client';

import { useMemo, useState } from 'react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { StreamInfoDrawer } from '@/components/jellyfin/stream-info-drawer';
import { ticksToProgress } from '@/lib/jellyfin-helpers';
import type { JellyfinSession } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';
import {
  Bar,
  Dot,
  FONT_DISPLAY,
  FONT_MONO,
  HPR,
  Pill,
  Poster,
  SectionHeader,
  ViewModeToggle,
  mix,
  toneFromString,
} from './bento-primitives';
import { useDashboardLayout } from './dashboard-layout-context';

async function fetchSessions(): Promise<JellyfinSession[]> {
  const res = await fetch('/api/jellyfin/sessions');
  if (!res.ok) throw new Error(`Failed to fetch sessions (${res.status})`);
  const data: { sessions: JellyfinSession[] } = await res.json();
  return data.sessions;
}

function fmtTicks(ticks?: number): string {
  if (ticks == null) return '–';
  const secs = Math.floor(ticks / 10_000_000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function NowStreamingWidget({
  refreshInterval,
  editMode = false,
  narrow = false,
  layoutVariant,
  instanceId,
  mobileGrid = false,
}: WidgetProps) {
  const { data: sessions, loading } = useWidgetData({
    fetchFn: fetchSessions,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'now-streaming',
  });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selectedSession = useMemo(
    () => sessions?.find((s) => s.Id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const { setWidgetLayoutOverride } = useDashboardLayout();

  const list = sessions ?? [];
  const useList = narrow || layoutVariant === 'list';
  const toggleNode = !narrow && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next, { mobile: mobileGrid })}
    />
  ) : null;

  const liveBadge = list.length > 0 && (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <Dot color={HPR.green} size={7} pulse />
      <Pill color={HPR.green} style={{ fontSize: 9, marginLeft: 4 }}>
        {list.length} LIVE
      </Pill>
    </span>
  );

  if (loading && list.length === 0) {
    return (
      <div>
        <SectionHeader title="Now Streaming" right={toggleNode} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div>
        <SectionHeader title="Now Streaming" right={toggleNode} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
          {editMode ? 'No active streams' : 'Nothing playing right now'}
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        title={!narrow ? "Now Streaming" : undefined}
        badge={liveBadge}
        right={
          <>
            {toggleNode}
            {!narrow && <span>{list.length} active</span>}
          </>
        }
      />
      {useList ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map((s) => {
            const np = s.NowPlayingItem;
            const title = np?.SeriesName || np?.Name || 'Unknown';
            const sub = np?.IndexNumber != null
              ? `S${np.ParentIndexNumber ?? 1} · E${np.IndexNumber}`
              : np?.ProductionYear?.toString() ?? '';
            const tone = toneFromString(title);
            const pct = np?.RunTimeTicks && s.PlayState?.PositionTicks != null
              ? ticksToProgress(s.PlayState.PositionTicks, np.RunTimeTicks)
              : 0;
            const direct = (s.PlayState?.PlayMethod ?? '').toLowerCase().includes('direct');
            const imageId = np?.SeriesId || np?.Id;
            const imageUrl = imageId
              ? `/api/jellyfin/image?itemId=${imageId}&type=Primary&maxWidth=200&quality=80`
              : undefined;
            return (
              <button
                key={s.Id}
                type="button"
                onClick={() => setSelectedSessionId(s.Id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 8,
                  background: HPR.ink,
                  border: `1px solid ${HPR.hairline}`,
                  borderRadius: 7,
                  textAlign: 'left',
                  cursor: editMode ? 'default' : 'pointer',
                  color: HPR.fg,
                }}
              >
                <Poster width={32} height={48} label={title} tone={tone} fontSize={7} imageUrl={imageUrl} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: HPR.fg,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {title}{' '}
                    <span
                      style={{
                        color: HPR.fgMute,
                        fontFamily: FONT_MONO,
                        fontSize: 10,
                        fontWeight: 400,
                      }}
                    >
                      {sub}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: HPR.fgMute,
                      fontFamily: FONT_MONO,
                      marginTop: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {s.UserName} · {s.DeviceName || s.Client}
                  </div>
                  <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Pill
                      color={direct ? HPR.green : HPR.amber}
                      style={{ fontSize: 8, padding: '1px 5px' }}
                    >
                      {(s.PlayState?.PlayMethod || 'PLAY').toUpperCase()}
                    </Pill>
                    <div style={{ flex: 1 }}>
                      <Bar pct={pct} color={HPR.cyan} height={2} />
                    </div>
                    {!narrow && <span
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 9,
                        color: HPR.fgMute,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {fmtTicks(s.PlayState?.PositionTicks)}
                    </span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }} className="no-scrollbar">
          {list.map((s) => {
            const np = s.NowPlayingItem;
            const title = np?.SeriesName || np?.Name || 'Unknown';
            const sub = np?.IndexNumber != null
              ? `S${np.ParentIndexNumber ?? 1} · E${np.IndexNumber}`
              : np?.ProductionYear?.toString() ?? '';
            const tone = toneFromString(title);
            const pct = np?.RunTimeTicks && s.PlayState?.PositionTicks != null
              ? ticksToProgress(s.PlayState.PositionTicks, np.RunTimeTicks)
              : 0;
            const direct = (s.PlayState?.PlayMethod ?? '').toLowerCase().includes('direct');
            const codec = s.TranscodingInfo?.VideoCodec
              || np?.MediaStreams?.find((m) => m.Type === 'Video')?.Codec
              || '';
            const imageId = np?.SeriesId || np?.Id;
            const imageUrl = imageId
              ? `/api/jellyfin/image?itemId=${imageId}&type=Primary&maxWidth=200&quality=80`
              : undefined;
            return (
              <button
                key={s.Id}
                type="button"
                onClick={() => setSelectedSessionId(s.Id)}
                style={{
                  width: 260,
                  minWidth: 260,
                  flexShrink: 0,
                  padding: 10,
                  borderRadius: 8,
                  background: `linear-gradient(135deg, ${mix(HPR.cyan, 6)}, transparent 60%), ${HPR.ink}`,
                  border: `1px solid ${HPR.hairline}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  textAlign: 'left',
                  color: HPR.fg,
                  cursor: editMode ? 'default' : 'pointer',
                }}
              >
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ position: 'relative' }}>
                    <Poster width={54} height={80} label={title} tone={tone} fontSize={8} imageUrl={imageUrl} />
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 4,
                        right: -6,
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: HPR.ink,
                        border: `1.5px solid ${HPR.cyan}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: HPR.cyan,
                        fontSize: 10,
                      }}
                    >
                      ▶
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div
                      style={{
                        fontFamily: FONT_DISPLAY,
                        fontSize: 13,
                        color: HPR.fg,
                        fontWeight: 600,
                        lineHeight: 1.2,
                        letterSpacing: '-0.01em',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {title}
                    </div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: HPR.fgMute }}>{sub}</div>
                    <div
                      style={{
                        fontSize: 11,
                        color: HPR.fgMute,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      <span style={{ color: HPR.fg }}>{s.UserName}</span> · {s.DeviceName || s.Client}
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                      <Pill
                        color={direct ? HPR.green : HPR.amber}
                        style={{ fontSize: 8, padding: '1px 5px' }}
                      >
                        {(s.PlayState?.PlayMethod || 'PLAY').toUpperCase()}
                      </Pill>
                      {codec && (
                        <span
                          style={{
                            fontFamily: FONT_MONO,
                            fontSize: 9,
                            color: HPR.fgSubtle,
                            padding: '1px 5px',
                            background: HPR.surface,
                            borderRadius: 3,
                          }}
                        >
                          {codec.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto' }}>
                  <div style={{ flex: 1 }}>
                    <Bar pct={pct} color={HPR.cyan} height={3} />
                  </div>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      color: HPR.fgMute,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fmtTicks(s.PlayState?.PositionTicks)} / {fmtTicks(np?.RunTimeTicks)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <StreamInfoDrawer session={selectedSession} onClose={() => setSelectedSessionId(null)} />
    </div>
  );
}
