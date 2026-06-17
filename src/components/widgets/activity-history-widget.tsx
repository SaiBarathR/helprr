'use client';
import { ApiError } from '@/lib/query-fetch';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Download, Film, Tv, AlertTriangle, Trash2, Info, Import, Clock } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { formatDistanceToNowShort, formatBytes } from '@/lib/format';
import { toCachedImageSrc } from '@/lib/image';
import type { MediaImage } from '@/types';
import type { WidgetProps } from '@/lib/widgets/types';
import {
  CAROUSEL_CARD_HEIGHT,
  CAROUSEL_CARD_WIDTH,
  CAROUSEL_GAP,
  FONT_MONO,
  HPR,
  Hairline,
  Poster,
  SectionHeader,
  ViewModeToggle,
  mix,
  toneFromString,
} from './bento-primitives';
import { useDashboardLayout } from './dashboard-layout-context';
import { ActivityDetailDrawer, type ActivityDetailRecord } from './activity-detail-drawer';

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
  instanceId?: string;
  mediaType?: 'episode' | 'movie';
  seriesId?: number;
  movieId?: number;
  series?: {
    title: string;
    id: number;
    overview?: string;
    network?: string;
    year?: number;
    runtime?: number;
    certification?: string;
    genres?: string[];
    seriesType?: string;
    images?: MediaImage[];
  };
  episode?: {
    title?: string;
    seasonNumber: number;
    episodeNumber: number;
    id: number;
    airDate?: string;
    runtime?: number;
    overview?: string;
  };
  movie?: {
    title: string;
    id: number;
    overview?: string;
    year?: number;
    runtime?: number;
    certification?: string;
    genres?: string[];
    studio?: string;
    images?: MediaImage[];
  };
  quality?: { quality: { name: string; resolution?: number; source?: string } };
  customFormats?: { id: number; name: string }[];
  customFormatScore?: number;
  languages?: { id: number; name: string }[];
  data?: {
    indexer?: string;
    releaseGroup?: string | null;
    size?: string;
    downloadClient?: string;
    downloadClientName?: string;
    droppedPath?: string;
    importedPath?: string;
    message?: string;
    releaseType?: string;
    indexerFlags?: string;
  };
}

function getPosterUrl(r: HistoryRecord): string | null {
  const images = r.series?.images ?? r.movie?.images ?? [];
  const poster = images.find((img) => img.coverType === 'poster');
  if (!poster) return null;
  return (
    toCachedImageSrc(
      poster.remoteUrl || poster.url || null,
      r.source === 'radarr' ? 'radarr' : 'sonarr',
    ) ?? poster.remoteUrl ?? poster.url ?? null
  );
}

async function fetchHistory(pageSize: number): Promise<HistoryRecord[]> {
  const res = await fetch(`/api/activity/history?pageSize=${pageSize}`);
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data = await res.json();
  return data.records || [];
}

function getEventIcon(eventType: string) {
  switch (eventType) {
    case 'grabbed':
      return <Download className="h-3.5 w-3.5 text-blue-400" />;
    case 'downloadFolderImported':
    case 'episodeFileImported':
    case 'movieFileImported':
    case 'imported':
      return <Import className="h-3.5 w-3.5 text-green-400" />;
    case 'downloadFailed':
    case 'importFailed':
      return <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />;
    case 'deleted':
    case 'episodeFileDeleted':
    case 'movieFileDeleted':
      return <Trash2 className="h-3.5 w-3.5 text-rose-400" />;
    default:
      return <Download className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function getEventLabel(eventType: string): string {
  switch (eventType) {
    case 'grabbed': return 'Grabbed';
    case 'downloadFolderImported': return 'Imported';
    case 'episodeFileImported': return 'Imported';
    case 'movieFileImported': return 'Imported';
    case 'imported': return 'Imported';
    case 'downloadFailed': return 'Failed';
    case 'importFailed': return 'Import Failed';
    case 'renamed': return 'Renamed';
    case 'deleted':
    case 'episodeFileDeleted':
    case 'movieFileDeleted': return 'Deleted';
    case 'ignored': return 'Ignored';
    default: return eventType.replace(/([a-z])([A-Z])/g, '$1 $2');
  }
}

function eventKind(t: string): 'grabbed' | 'imported' | 'failed' {
  if (t === 'grabbed') return 'grabbed';
  if (t.includes('Failed')) return 'failed';
  return 'imported';
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
  const q = r.instanceId ? `?instance=${r.instanceId}` : '';
  if (r.source === 'radarr' && (r.movieId || r.movie?.id)) {
    return `/movies/${r.movieId || r.movie?.id}${q}`;
  }
  if (r.source === 'sonarr') {
    const sid = r.seriesId || r.series?.id;
    const ep = r.episode;
    if (sid && ep) return `/series/${sid}/season/${ep.seasonNumber}/episode/${ep.id}${q}`;
    if (sid) return `/series/${sid}${q}`;
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
  plain: { c: HPR.fgMute, bg: mix(HPR.fg, 5) },
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
  narrow = false,
  layoutVariant,
  rowSpan = 2,
  instanceId,
  mobileGrid = false,
}: WidgetProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const { setWidgetLayoutOverride } = useDashboardLayout();
  const [detail, setDetail] = useState<ActivityDetailRecord | null>(null);
  const useList = narrow || layoutVariant !== 'carousel';
  const detailed = useList && (layoutVariant === 'detailed' || rowSpan >= 2);
  const { visibleCount: listVisible, fetchSize: heightFetchSize } = useListFetchSize({
    height,
    rowHeight: detailed ? ROW_HEIGHT + 14 : ROW_HEIGHT,
  });
  const carouselVisible = width > 0
    ? Math.ceil(width / (CAROUSEL_CARD_WIDTH + CAROUSEL_GAP)) + 4
    : 10;
  const visibleCount = Math.max(listVisible, carouselVisible);
  const fetchPageSize = Math.max(heightFetchSize, Math.ceil(carouselVisible / 20) * 20);
  const fetchFn = useCallback(() => fetchHistory(fetchPageSize), [fetchPageSize]);
  const { data, loading } = useWidgetData({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `activity-history-${fetchPageSize}`,
  });
  const list = data ?? [];
  const toggleNode = !narrow && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next, { mobile: mobileGrid })}
    />
  ) : null;
  // Shortcut straight to the full history page (sits left of the view-mode switcher)
  // so history is reachable from the dashboard without going via the Activity page.
  const historyNode = (
    <Link
      href="/activity/history"
      aria-label="Activity history"
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'inline-flex', alignItems: 'center', color: 'inherit', marginRight: 4 }}
    >
      <Clock size={14} strokeWidth={2} />
    </Link>
  );
  const headerRight = (
    <>
      {historyNode}
      {toggleNode}
      <Link href="/activity?tab=queue" style={{ color: 'inherit', textDecoration: 'none' }}>
        View all →
      </Link>
    </>
  );

  const openDetail = (r: HistoryRecord) => setDetail(r as ActivityDetailRecord);

  if (loading && list.length === 0) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title="Activity" right={<>{historyNode}{toggleNode}</>} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title="Activity" right={<>{historyNode}{toggleNode}</>} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
          No recent activity
        </div>
      </div>
    );
  }

  if (useList) {
    return (
      <>
        <div
          ref={ref}
          style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
        >
          <SectionHeader title="Activity" right={headerRight} />
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

              const primaryParts: string[] = [`${formatDistanceToNowShort(r.date)} ago`];
              if (qualityName) primaryParts.push(qualityName);
              if (r.eventType) {
                primaryParts.unshift(getEventLabel(r.eventType));
              }

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
                    {getEventIcon(r.eventType)}
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
                      {primaryParts.join(' · ')}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 2,
                      }}
                    >
                      {fileSize && (
                        <span style={{ fontSize: 10, color: HPR.fgMute, fontFamily: FONT_MONO }}>
                          {fileSize}
                        </span>
                      )}
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
                    className='flex-col align-center gap-2'
                  >
                    {r.mediaType === 'movie' ? <Film size={13} /> : <Tv size={13} />}
                    <DetailButton onClick={() => openDetail(r)} />
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
        <ActivityDetailDrawer record={detail} onClose={() => setDetail(null)} />
      </>
    );
  }

  return (
    <>
      <div ref={ref}>
        <SectionHeader title="Activity" right={headerRight} />
        <div
          className="no-scrollbar"
          style={{ display: 'flex', gap: CAROUSEL_GAP, overflowX: 'auto', paddingBottom: 4 }}
        >
          {list.slice(0, visibleCount).map((r) => {
            const kind = eventKind(r.eventType);
            const color = eventColor(kind);
            const title = getTitle(r);
            const qualityName = r.quality?.quality?.name;
            const fileSize = r.data?.size ? formatBytes(Number(r.data.size)) : null;
            const href = getHref(r);
            const posterUrl = getPosterUrl(r);

            const card = (
              <>
                <Poster
                  width={CAROUSEL_CARD_WIDTH}
                  height={CAROUSEL_CARD_HEIGHT}
                  label={title}
                  tone={toneFromString(title)}
                  fontSize={11}
                  imageUrl={posterUrl ?? undefined}
                  timePill={`${formatDistanceToNowShort(r.date)} ago`}
                  badge={{ icon: getEventIcon(r.eventType), color }}
                />
                <div className='mt-0 md:mt-1.5'>
                  <div
                    style={{
                      fontSize: 11,
                      color: HPR.fg,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontWeight: 500,
                    }}
                  >
                    {title}
                  </div>
                  {qualityName && (
                    <div
                      style={{
                        fontSize: 9,
                        color: HPR.fgMute,
                        fontFamily: FONT_MONO,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: 'flex',
                        justifyContent: 'space-between',
                        maxWidth: '100%',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          color: HPR.fgMute,
                          fontFamily: FONT_MONO,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          minWidth: 0,
                          width: '62%',
                        }}
                      >
                        {qualityName}
                      </span>
                      {fileSize && (
                        <span
                          style={{
                            fontSize: 9,
                            color: HPR.fgMute,
                            fontFamily: FONT_MONO,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            minWidth: 0,
                          }}
                        >
                          {fileSize}
                        </span>
                      )}
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                    className='md:mt-0.5'
                  >
                    <span
                      style={{
                        fontSize: 9,
                        color: HPR.fgMute,
                        fontFamily: FONT_MONO,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      {r.eventType ? getEventLabel(r.eventType) : ''}
                    </span>
                    <DetailButton onClick={() => openDetail(r)} />
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                    className='md:mt-0.5'
                  >
                    <span
                      style={{
                        fontSize: 9,
                        color: HPR.fgMute,
                        fontFamily: FONT_MONO,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      {r?.data?.indexer ? r.data.indexer : r?.data?.releaseGroup ? r.data.releaseGroup : ''}
                    </span>
                  </div>

                </div>
              </>
            );

            return href && !editMode ? (
              <Link
                key={`${r.source}-${r.id}`}
                href={href}
                style={{
                  width: CAROUSEL_CARD_WIDTH,
                  flexShrink: 0,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                {card}
              </Link>
            ) : (
              <div
                key={`${r.source}-${r.id}`}
                style={{ width: CAROUSEL_CARD_WIDTH, flexShrink: 0 }}
              >
                {card}
              </div>
            );
          })}
        </div>
      </div>
      <ActivityDetailDrawer record={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function DetailButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="View details"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        padding: 0,
        marginLeft: 'auto',
        borderRadius: 4,
        border: 'none',
        background: mix(HPR.fg, 4),
        color: HPR.fgMute,
        cursor: 'pointer',
      }}
    >
      <Info size={11} strokeWidth={2} />
    </button>
  );
}
