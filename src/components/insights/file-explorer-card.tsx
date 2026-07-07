'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Scale, X } from 'lucide-react';
import { HPR, mix } from '@/components/widgets/bento-primitives';
import { formatBytes } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageControls } from '@/components/ui/page-controls';
import { Panel, PanelLoading, PanelEmpty, useInsightsResource } from './insights-shared';
import { type MediaAnalysisKindFilter } from './technical-breakdown-card';
import { ScoreBadge } from './quality-score-card';
import type { MediaAnalysisFile, MediaAnalysisFilesResponse } from '@/types/insights';

// MediaLyze-style file explorer: server-side filtered/sorted/paginated table of
// every media file's technical details, with pick-up-to-4 side-by-side comparison.

const PAGE_SIZE = 25;
const COMPARE_MAX = 4;
const ALL = 'all'; // Select sentinel — shadcn SelectItem forbids an empty value

type SortKey = 'size' | 'bitrate' | 'score' | 'title';

const SORT_LABELS: Record<SortKey, string> = {
  size: 'Size',
  bitrate: 'Bitrate',
  score: 'Score',
  title: 'Title',
};

// `estimated` marks values derived from size/runtime rather than measured.
function fmtBitrate(bps: number | null, estimated = false): string {
  return bps !== null ? `${estimated ? '≈' : ''}${(bps / 1_000_000).toFixed(1)} Mbps` : '—';
}

function fmtRuntime(mins: number | null): string {
  if (mins === null) return '—';
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}

// Attribute rows for the comparison table.
const COMPARE_ROWS: { label: string; value: (f: MediaAnalysisFile) => string }[] = [
  { label: 'Type', value: (f) => (f.kind === 'movie' ? 'Movie' : 'Episode') },
  { label: 'Resolution', value: (f) => f.resolution ?? '—' },
  { label: 'Video codec', value: (f) => f.videoCodec ?? '—' },
  { label: 'Video bitrate', value: (f) => fmtBitrate(f.videoBitrate, f.bitrateEstimated) },
  { label: 'Bit depth', value: (f) => (f.videoBitDepth !== null ? `${f.videoBitDepth}-bit` : '—') },
  { label: 'Dynamic range', value: (f) => f.dynamicRange ?? '—' },
  { label: 'Frame rate', value: (f) => (f.videoFps !== null ? `${f.videoFps} fps` : '—') },
  { label: 'Audio codec', value: (f) => f.audioCodec ?? '—' },
  { label: 'Audio channels', value: (f) => (f.audioChannels !== null ? String(f.audioChannels) : '—') },
  { label: 'Audio languages', value: (f) => (f.audioLanguages.length > 0 ? f.audioLanguages.join(', ') : '—') },
  { label: 'Subtitles', value: (f) => (f.subtitleCount !== null ? String(f.subtitleCount) : '—') },
  { label: 'Runtime', value: (f) => fmtRuntime(f.runtimeMins) },
  { label: 'Size', value: (f) => formatBytes(f.size) },
  { label: 'Score', value: (f) => (f.score !== null ? String(f.score) : '—') },
];

function CompareDialog({ files, open, onClose }: {
  files: MediaAnalysisFile[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare files</DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr>
                <th className="w-28 py-1.5 pr-2 text-left font-normal" style={{ color: HPR.fgMute }} />
                {files.map((f) => (
                  <th key={f.id} className="py-1.5 px-2 text-left align-bottom">
                    <span className="line-clamp-2 font-semibold" style={{ color: HPR.fg }}>{f.title}</span>
                    {f.subtitle && (
                      <span className="block truncate max-w-40 text-[10px] font-normal" style={{ color: HPR.fgSubtle }}>
                        {f.subtitle}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--hpr-hairline)' }}>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label}>
                  <td className="py-1.5 pr-2 whitespace-nowrap" style={{ color: HPR.fgMute }}>{row.label}</td>
                  {files.map((f) => (
                    <td key={f.id} className="py-1.5 px-2 tabular-nums" style={{ color: HPR.fg }}>
                      {row.value(f)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-24 shrink-0 text-xs">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: all</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FileRow({ file, selected, selectable, onToggle }: {
  file: MediaAnalysisFile;
  selected: boolean;
  selectable: boolean;
  onToggle: (file: MediaAnalysisFile, checked: boolean) => void;
}) {
  const chips = [
    file.resolution,
    file.videoCodec,
    file.videoBitrate !== null ? fmtBitrate(file.videoBitrate, file.bitrateEstimated) : null,
    file.dynamicRange && file.dynamicRange !== 'SDR' ? file.dynamicRange : null,
    file.audioCodec && file.audioChannels !== null ? `${file.audioCodec} ${file.audioChannels}` : file.audioCodec,
  ].filter((c): c is string => !!c);

  return (
    <div className="flex items-center gap-2.5 py-2">
      <Checkbox
        checked={selected}
        disabled={!selected && !selectable}
        onCheckedChange={(v) => onToggle(file, v === true)}
        aria-label={`Select ${file.title} for comparison`}
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 text-xs">
          {file.href ? (
            <Link href={file.href} className="truncate font-medium hover:underline" style={{ color: HPR.fg }}>
              {file.title}
            </Link>
          ) : (
            <span className="truncate font-medium" style={{ color: HPR.fg }}>{file.title}</span>
          )}
          {file.subtitle && (
            <span className="truncate shrink-[2] text-[10px]" style={{ color: HPR.fgSubtle }}>{file.subtitle}</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded px-1 py-px text-[9px] tabular-nums"
              style={{ background: mix(HPR.fgMute, 12), color: HPR.fgMute, fontFamily: 'var(--hpr-font-mono)' }}
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
      <span className="tabular-nums text-[10px] shrink-0" style={{ color: HPR.fgMute }}>
        {formatBytes(file.size)}
      </span>
      {file.score !== null && <ScoreBadge score={file.score} />}
    </div>
  );
}

export function FileExplorerCard({ kind }: { kind: MediaAnalysisKindFilter }) {
  const [search, setSearch] = React.useState('');
  const [q, setQ] = React.useState('');
  const [resolution, setResolution] = React.useState(ALL);
  const [videoCodec, setVideoCodec] = React.useState(ALL);
  const [dynamicRange, setDynamicRange] = React.useState(ALL);
  const [audioCodec, setAudioCodec] = React.useState(ALL);
  const [sort, setSort] = React.useState<SortKey>('size');
  const [dir, setDir] = React.useState<'asc' | 'desc'>('desc');
  const [page, setPage] = React.useState(1);
  // Selected rows keep their full objects — pages change under the selection.
  const [selected, setSelected] = React.useState<Map<string, MediaAnalysisFile>>(new Map());
  const [compareOpen, setCompareOpen] = React.useState(false);

  // Debounce typing into the actual query param.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any dataset-narrowing change starts back at page 1.
  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const params = new URLSearchParams();
  if (kind !== 'all') params.set('kind', kind);
  if (q) params.set('q', q);
  if (resolution !== ALL) params.set('resolution', resolution);
  if (videoCodec !== ALL) params.set('videoCodec', videoCodec);
  if (dynamicRange !== ALL) params.set('dynamicRange', dynamicRange);
  if (audioCodec !== ALL) params.set('audioCodec', audioCodec);
  params.set('sort', sort);
  params.set('dir', dir);
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));

  const { data, loading } = useInsightsResource<MediaAnalysisFilesResponse>(
    `/api/insights/media-analysis/files?${params.toString()}`
  );

  // Kind is page-level state; a switch there restarts pagination too.
  React.useEffect(() => setPage(1), [kind]);

  const toggleSelect = React.useCallback((file: MediaAnalysisFile, checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (checked) next.set(file.id, file);
      else next.delete(file.id);
      return next;
    });
  }, []);

  const selectedFiles = [...selected.values()];

  return (
    <Panel
      title="File explorer"
      right={
        data ? (
          <span className="tabular-nums" style={{ fontFamily: 'var(--hpr-font-mono)' }}>
            {data.total.toLocaleString()} file{data.total === 1 ? '' : 's'}
          </span>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or file name…"
          className="h-8 text-xs"
        />
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-0.5">
          <FilterSelect label="Resolution" value={resolution} options={data?.options.resolution ?? []} onChange={resetPage(setResolution)} />
          <FilterSelect label="Codec" value={videoCodec} options={data?.options.videoCodec ?? []} onChange={resetPage(setVideoCodec)} />
          <FilterSelect label="Range" value={dynamicRange} options={data?.options.dynamicRange ?? []} onChange={resetPage(setDynamicRange)} />
          <FilterSelect label="Audio" value={audioCodec} options={data?.options.audioCodec ?? []} onChange={resetPage(setAudioCodec)} />
          <Select value={sort} onValueChange={(v) => resetPage(setSort)(v as SortKey)}>
            <SelectTrigger className="h-8 w-auto min-w-20 shrink-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <SelectItem key={k} value={k}>{SORT_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 px-2"
            onClick={() => resetPage(setDir)(dir === 'desc' ? 'asc' : 'desc')}
            aria-label={dir === 'desc' ? 'Sorted descending' : 'Sorted ascending'}
          >
            {dir === 'desc' ? <ArrowDownWideNarrow className="h-3.5 w-3.5" /> : <ArrowUpNarrowWide className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {selectedFiles.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5" style={{ background: mix(HPR.blue, 10) }}>
            <span className="text-xs" style={{ color: HPR.fg }}>
              {selectedFiles.length} of {COMPARE_MAX} selected
            </span>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelected(new Map())}>
                <X className="mr-1 h-3 w-3" /> Clear
              </Button>
              <Button size="sm" className="h-7 px-2 text-xs" disabled={selectedFiles.length < 2} onClick={() => setCompareOpen(true)}>
                <Scale className="mr-1 h-3 w-3" /> Compare
              </Button>
            </div>
          </div>
        )}

        {loading && !data ? (
          <PanelLoading height={240} />
        ) : !data || data.rows.length === 0 ? (
          <PanelEmpty message="No files match these filters." height={240} />
        ) : (
          <>
            <div className="divide-y" style={{ borderColor: 'var(--hpr-hairline)' }}>
              {data.rows.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  selected={selected.has(file.id)}
                  selectable={selected.size < COMPARE_MAX}
                  onToggle={toggleSelect}
                />
              ))}
            </div>
            {data.total > PAGE_SIZE && (
              <PageControls page={data.page} total={data.total} pageSize={PAGE_SIZE} onPage={setPage} loading={loading} />
            )}
          </>
        )}
      </div>

      <CompareDialog files={selectedFiles} open={compareOpen} onClose={() => setCompareOpen(false)} />
    </Panel>
  );
}
