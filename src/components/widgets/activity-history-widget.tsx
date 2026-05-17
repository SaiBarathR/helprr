'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowDownToLine, Check, Film, Tv } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { formatDistanceToNowShort, formatBytes } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';
import {
  FONT_MONO,
  HPR,
  Hairline,
  SECTION_HEADER_HEIGHT,
  SectionHeader,
  mix,
} from './bento-primitives';

// Activity rows are taller when "detailed" (chips wrap); use a row estimate
// that splits the difference. Buffer above the visible count handles the
// extra space chips can take.
const ROW_HEIGHT = 56;

interface HistoryRecord {
  id: number;
  eventType: string;
  date: string;
  sourceTitle?: string;
  source?: 'sonarr' | 'radarr';
  mediaType?: 'episode' | 'movie';
  seriesId?: number;
  movieId?: number;
  series?: { title: string; id: number };
  episode?: { title: string; seasonNumber: number; episodeNumber: number; id: number };
  movie?: { title: string; id: number };
  quality?: { quality: { name: string } };
  customFormats?: { id: number; name: string }[];
  data?: { indexer?: string; releaseGroup?: string; size?: string };
}

async function fetchHistory(pageSize: number): Promise<HistoryRecord[]> {
  const res = await fetch(`/api/activity/history?pageSize=${pageSize}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.records || [];
}

function eventKind(t: string): 'grabbed' | 'imported' | 'failed' {
  if (t === 'grabbed') return 'grabbed';
  if (t.includes('Failed')) return 'failed';
  return 'imported';
}

function EventIcon({ kind }: { kind: ReturnType<typeof eventKind> }) {
  if (kind === 'grabbed') return <ArrowDownToLine size={12} strokeWidth={2.4} />;
  if (kind === 'imported') return <Check size={13} strokeWidth={2.6} />;
  return <AlertTriangle size={12} strokeWidth={2.4} />;
}

function eventColor(kind: ReturnType<typeof eventKind>): string {
  return kind === 'grabbed' ? HPR.blue : kind === 'imported' ? HPR.green : HPR.rose;
}

function getTitle(r: HistoryRecord): string {
  if (r.movie?.title) return r.movie.title;
  if (r.series?.title) {
    const ep = r.episode;
    if (ep) {
      return `${r.series.title} S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`;
    }
    return r.series.title;
  }
  return r.sourceTitle || 'Unknown';
}

function getHref(r: HistoryRecord): string | null {
  if (r.source === 'radarr' && (r.movieId || r.movie?.id)) {
    return `/movies/${r.movieId || r.movie?.id}`;
  }
  if (r.source === 'sonarr') {
    const sid = r.seriesId || r.series?.id;
    const ep = r.episode;
    if (sid && ep) return `/series/${sid}/season/${ep.seasonNumber}/episode/${ep.id}`;
    if (sid) return `/series/${sid}`;
  }
  return null;
}

function formatTone(name: string): 'purple' | 'amber' | 'blue' | 'plain' {
  const upper = name.toUpperCase();
  if (/NF|AMZN|HMAX|DSNP/.test(upper)) return 'purple';
  if (/ATMOS|DDP|TRUEHD|HDR/.test(upper)) return 'amber';
  if (/DV|DOLBY VISION|HEVC|AV1/.test(upper)) return 'blue';
  return 'plain';
}

const CHIP_TONES = {
  plain: { c: HPR.fgMute, bg: 'rgba(255,255,255,0.05)' },
  purple: { c: HPR.purple, bg: mix(HPR.purple, 10) },
  amber: { c: HPR.amber, bg: mix(HPR.amber, 14) },
  blue: { c: HPR.blue, bg: mix(HPR.blue, 10) },
} as const;

function ActivityChip({
  children,
  tone = 'plain',
}: {
  children: React.ReactNode;
  tone?: keyof typeof CHIP_TONES;
}) {
  const t = CHIP_TONES[tone];
  return (
    <span
      style={{
        padding: '1px 6px',
        borderRadius: 4,
        background: t.bg,
        color: t.c,
        fontFamily: FONT_MONO,
        fontSize: 9,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function ActivityHistoryWidget({
  refreshInterval,
  editMode = false,
  layoutVariant,
  rowSpan = 2,
}: WidgetProps) {
  const { ref, height } = useElementSize<HTMLDivElement>();
  const detailed = layoutVariant === 'detailed' || rowSpan >= 2;
  const visibleCount = useMemo(() => {
    if (height <= 0) return detailed ? 5 : 4;
    const rowH = detailed ? ROW_HEIGHT + 14 : ROW_HEIGHT;
    return Math.max(4, Math.ceil((height - SECTION_HEADER_HEIGHT) / rowH) + 3);
  }, [height, detailed]);
  const fetchPageSize = Math.ceil(visibleCount / 5) * 5;
  const fetchFn = useCallback(() => fetchHistory(fetchPageSize), [fetchPageSize]);
  const { data, loading } = useWidgetData({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `activity-history-${fetchPageSize}`,
  });
  const list = data ?? [];

  if (loading && list.length === 0) {
    return (
      <div ref={ref}>
        <SectionHeader title="Activity" />
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div ref={ref}>
        <SectionHeader title="Activity" />
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
          No recent activity
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <SectionHeader title="Activity" right={<span>View all →</span>} />
      <div
        className="no-scrollbar scroll-fade-y"
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        {list.slice(0, visibleCount).map((r, i) => {
          const kind = eventKind(r.eventType);
          const color = eventColor(kind);
          const title = getTitle(r);
          const qualityName = r.quality?.quality?.name;
          const releaseGroup = r.data?.releaseGroup;
          const indexer = r.data?.indexer;
          const fileSize = r.data?.size ? formatBytes(Number(r.data.size)) : null;
          const customFormats = (r.customFormats || []).filter((cf) => cf.name);
          const href = getHref(r);

          const metaParts: string[] = [];
          metaParts.push(`${formatDistanceToNowShort(r.date)} ago`);
          if (qualityName) metaParts.push(qualityName);
          if (fileSize) metaParts.push(fileSize);

          const inner = (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0' }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 5,
                  background: mix(color, 14),
                  color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <EventIcon kind={kind} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: HPR.fg,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontWeight: 500,
                  }}
                >
                  {title}
                </div>
                <div
                  style={{ fontSize: 10, color: HPR.fgMute, fontFamily: FONT_MONO, marginTop: 2 }}
                >
                  {metaParts.join(' · ')}
                </div>
                {detailed && (releaseGroup || indexer || customFormats.length > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                    {releaseGroup && <ActivityChip>{releaseGroup}</ActivityChip>}
                    {indexer && <ActivityChip>{indexer}</ActivityChip>}
                    {customFormats.slice(0, 3).map((cf) => (
                      <ActivityChip key={cf.id} tone={formatTone(cf.name)}>
                        {cf.name}
                      </ActivityChip>
                    ))}
                    {customFormats.length > 3 && (
                      <ActivityChip>+{customFormats.length - 3}</ActivityChip>
                    )}
                  </div>
                )}
              </div>
              <span
                style={{
                  color: r.mediaType === 'movie' ? HPR.blue : HPR.purple,
                  flexShrink: 0,
                  marginTop: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                {r.mediaType === 'movie' ? <Film size={13} /> : <Tv size={13} />}
              </span>
            </div>
          );

          return (
            <div key={`${r.source}-${r.id}`}>
              {i > 0 && <Hairline />}
              {href && !editMode ? (
                <Link href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
