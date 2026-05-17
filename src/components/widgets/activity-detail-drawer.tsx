'use client';

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ArrowDownToLine, Check, Film, Tv } from 'lucide-react';
import { formatBytes, formatDistanceToNowShort } from '@/lib/format';
import { toCachedImageSrc } from '@/lib/image';
import type { MediaImage } from '@/types';
import { FONT_MONO, HPR } from './bento-primitives';

export interface ActivityDetailRecord {
  id: number;
  eventType: string;
  date: string;
  sourceTitle?: string;
  source?: 'sonarr' | 'radarr';
  mediaType?: 'episode' | 'movie';
  quality?: { quality?: { name?: string; resolution?: number; source?: string } };
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
    publishedDate?: string;
    age?: string;
  };
  episode?: {
    title?: string;
    seasonNumber: number;
    episodeNumber: number;
    airDate?: string;
    runtime?: number;
    overview?: string;
  };
  series?: {
    title: string;
    overview?: string;
    network?: string;
    year?: number;
    runtime?: number;
    certification?: string;
    genres?: string[];
    seriesType?: string;
    images?: MediaImage[];
  };
  movie?: {
    title: string;
    overview?: string;
    year?: number;
    runtime?: number;
    certification?: string;
    genres?: string[];
    studio?: string;
    images?: MediaImage[];
  };
}

interface Props {
  record: ActivityDetailRecord | null;
  onClose: () => void;
}

function eventKind(t: string): 'grabbed' | 'imported' | 'failed' | 'other' {
  if (t === 'grabbed') return 'grabbed';
  if (t.includes('Failed')) return 'failed';
  if (t.includes('Imported') || t.includes('imported')) return 'imported';
  return 'other';
}

function eventLabel(kind: ReturnType<typeof eventKind>): string {
  if (kind === 'grabbed') return 'Grabbed';
  if (kind === 'imported') return 'Imported';
  if (kind === 'failed') return 'Failed';
  return 'Event';
}

function EventIcon({ kind }: { kind: ReturnType<typeof eventKind> }) {
  if (kind === 'grabbed') return <ArrowDownToLine className="h-3.5 w-3.5" />;
  if (kind === 'imported') return <Check className="h-3.5 w-3.5" />;
  if (kind === 'failed') return <AlertTriangle className="h-3.5 w-3.5" />;
  return <Check className="h-3.5 w-3.5" />;
}

function eventColor(kind: ReturnType<typeof eventKind>): string {
  if (kind === 'grabbed') return HPR.blue;
  if (kind === 'imported') return HPR.green;
  if (kind === 'failed') return HPR.rose;
  return HPR.fgMute;
}

function getPosterUrl(r: ActivityDetailRecord): string | null {
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

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span
        className="shrink-0 text-[10px] uppercase tracking-wide"
        style={{ color: HPR.fgSubtle, fontFamily: FONT_MONO, minWidth: 88 }}
      >
        {label}
      </span>
      <span className="text-xs break-words" style={{ color: HPR.fg }}>
        {value}
      </span>
    </div>
  );
}

export function ActivityDetailDrawer({ record, onClose }: Props) {
  const open = record !== null;
  const kind = record ? eventKind(record.eventType) : 'other';
  const color = eventColor(kind);
  const title = record
    ? record.movie?.title ??
      (record.series?.title
        ? record.episode
          ? `${record.series.title} · S${String(record.episode.seasonNumber).padStart(2, '0')}E${String(record.episode.episodeNumber).padStart(2, '0')}`
          : record.series.title
        : (record.sourceTitle ?? 'Unknown'))
    : '';
  const posterUrl = record ? getPosterUrl(record) : null;
  const isMovie = record?.mediaType === 'movie';
  const media = record?.movie ?? record?.series;
  const ep = record?.episode;
  const quality = record?.quality?.quality?.name;
  const formats = (record?.customFormats ?? []).filter((c) => c.name);
  const languages = (record?.languages ?? []).map((l) => l.name).join(', ');
  const fileSize = record?.data?.size ? formatBytes(Number(record.data.size)) : null;
  const indexer = record?.data?.indexer;
  const releaseGroup = record?.data?.releaseGroup;
  const downloadClient = record?.data?.downloadClientName ?? record?.data?.downloadClient;
  const droppedPath = record?.data?.droppedPath;
  const importedPath = record?.data?.importedPath;
  const message = record?.data?.message;
  const releaseType = record?.data?.releaseType;
  const indexerFlags = record?.data?.indexerFlags;

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center rounded p-1"
              style={{ background: `${color}1a`, color }}
            >
              <EventIcon kind={kind} />
            </span>
            <DrawerTitle className="text-sm font-medium">{title}</DrawerTitle>
            <Badge
              variant="outline"
              className="ml-auto text-[10px]"
              style={{ color, borderColor: `${color}55` }}
            >
              {eventLabel(kind)}
            </Badge>
          </div>
          <div className="text-[11px]" style={{ color: HPR.fgMute, fontFamily: FONT_MONO }}>
            {record ? `${formatDistanceToNowShort(record.date)} ago` : ''}
            {record ? ` · ${new Date(record.date).toLocaleString()}` : ''}
          </div>
        </DrawerHeader>

        <div className="max-h-[70vh] overflow-y-auto px-4 pb-6 space-y-4">
          {/* Media block */}
          {record && media && (
            <div className="flex gap-3">
              <div
                className="shrink-0 overflow-hidden rounded"
                style={{
                  width: 88,
                  height: 132,
                  background: posterUrl ? `url("${posterUrl}") center/cover` : HPR.ink,
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
                }}
                aria-hidden="true"
              >
                {!posterUrl && (
                  <div
                    className="flex h-full items-center justify-center text-[10px]"
                    style={{ color: HPR.fgSubtle }}
                  >
                    {isMovie ? <Film className="h-4 w-4" /> : <Tv className="h-4 w-4" />}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium" style={{ color: HPR.fg }}>
                  {media.title}
                </div>
                <div
                  className="text-[10px] mt-0.5"
                  style={{ color: HPR.fgMute, fontFamily: FONT_MONO }}
                >
                  {[
                    media.year,
                    record.series?.network ?? record.movie?.studio,
                    media.certification,
                    media.runtime ? `${media.runtime} min` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {!!media.genres?.length && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {media.genres.slice(0, 6).map((g) => (
                      <Badge key={g} variant="secondary" className="text-[9px] px-1 py-0">
                        {g}
                      </Badge>
                    ))}
                  </div>
                )}
                {ep && (
                  <div
                    className="mt-1.5 text-[11px]"
                    style={{ color: HPR.fg }}
                  >
                    <span style={{ fontFamily: FONT_MONO, color: HPR.fgMute }}>
                      S{String(ep.seasonNumber).padStart(2, '0')}E{String(ep.episodeNumber).padStart(2, '0')}
                    </span>
                    {ep.title ? ` · ${ep.title}` : ''}
                  </div>
                )}
                {(ep?.overview || media.overview) && (
                  <p
                    className="mt-1.5 text-[11px] leading-snug line-clamp-4"
                    style={{ color: HPR.fgMute }}
                  >
                    {ep?.overview || media.overview}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Release info */}
          <div>
            <div
              className="text-[10px] uppercase tracking-wide mb-1"
              style={{ color: HPR.fgSubtle, fontFamily: FONT_MONO }}
            >
              Release
            </div>
            <Field label="Quality" value={quality} />
            <Field label="Languages" value={languages || null} />
            <Field label="Size" value={fileSize} />
            <Field label="Release Group" value={releaseGroup ?? null} />
            <Field label="Indexer" value={indexer} />
            <Field label="Indexer Flags" value={indexerFlags} />
            <Field label="Release Type" value={releaseType} />
            <Field label="Download Client" value={downloadClient} />
            <Field label="Source Title" value={record?.sourceTitle} />
            {!!formats.length && (
              <div className="mt-1 flex flex-wrap gap-1">
                {formats.map((f) => (
                  <Badge key={f.id} variant="outline" className="text-[9px] px-1 py-0">
                    {f.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Paths (import only) */}
          {(droppedPath || importedPath) && (
            <div>
              <div
                className="text-[10px] uppercase tracking-wide mb-1"
                style={{ color: HPR.fgSubtle, fontFamily: FONT_MONO }}
              >
                Paths
              </div>
              <Field label="Dropped" value={droppedPath} />
              <Field label="Imported" value={importedPath} />
            </div>
          )}

          {/* Failure message */}
          {message && (
            <div>
              <div
                className="text-[10px] uppercase tracking-wide mb-1"
                style={{ color: HPR.fgSubtle, fontFamily: FONT_MONO }}
              >
                Reason
              </div>
              <p className="text-xs" style={{ color: HPR.rose }}>
                {message}
              </p>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
