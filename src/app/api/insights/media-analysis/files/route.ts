import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getMediaAnalysisDataset } from '@/lib/media-analysis';
import type { MediaAnalysisFile, MediaAnalysisFilesResponse } from '@/types/insights';
import { withApiLogging } from '@/lib/api-logger';

// Server-side filter/sort/paginate over the normalized dataset. The dataset can be
// tens of thousands of episode files, so rows never ship to the client in bulk —
// the explorer card pages through this endpoint instead.

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

type SortKey = 'size' | 'bitrate' | 'score' | 'title';

const SORTERS: Record<SortKey, (a: MediaAnalysisFile, b: MediaAnalysisFile) => number> = {
  size: (a, b) => a.size - b.size,
  // Unknowns sort as -1 so they group at the small end instead of interleaving.
  bitrate: (a, b) => (a.videoBitrate ?? -1) - (b.videoBitrate ?? -1),
  score: (a, b) => (a.score ?? -1) - (b.score ?? -1),
  title: (a, b) => a.title.localeCompare(b.title) || (a.subtitle ?? '').localeCompare(b.subtitle ?? ''),
};

function distinct(rows: MediaAnalysisFile[], value: (r: MediaAnalysisFile) => string | null): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const v = value(row);
    if (v) set.add(v);
  }
  return [...set].sort();
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('insights.view');
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const params = request.nextUrl.searchParams;
  const kind = params.get('kind'); // 'movie' | 'episode' | null (all)

  const dataset = await getMediaAnalysisDataset({
    movies: can(user, 'movies.view') && kind !== 'episode',
    series: can(user, 'series.view') && kind !== 'movie',
  });

  // Filter options reflect the kind-scoped dataset (before the other filters),
  // so narrowing by codec doesn't erase the other codecs from the select.
  const options = {
    videoCodec: distinct(dataset.rows, (r) => r.videoCodec),
    resolution: distinct(dataset.rows, (r) => r.resolution),
    dynamicRange: distinct(dataset.rows, (r) => r.dynamicRange),
    audioCodec: distinct(dataset.rows, (r) => r.audioCodec),
  };

  const videoCodec = params.get('videoCodec');
  const resolution = params.get('resolution');
  const dynamicRange = params.get('dynamicRange');
  const audioCodec = params.get('audioCodec');
  const q = params.get('q')?.trim().toLowerCase() ?? '';

  let rows = dataset.rows;
  if (videoCodec) rows = rows.filter((r) => r.videoCodec === videoCodec);
  if (resolution) rows = rows.filter((r) => r.resolution === resolution);
  if (dynamicRange) rows = rows.filter((r) => r.dynamicRange === dynamicRange);
  if (audioCodec) rows = rows.filter((r) => r.audioCodec === audioCodec);
  if (q) {
    rows = rows.filter(
      (r) => r.title.toLowerCase().includes(q) || (r.subtitle?.toLowerCase().includes(q) ?? false),
    );
  }

  const sortParam = params.get('sort') as SortKey | null;
  const sorter = SORTERS[sortParam ?? 'size'] ?? SORTERS.size;
  const dir = params.get('dir') === 'asc' ? 1 : -1;
  rows = [...rows].sort((a, b) => sorter(a, b) * dir);

  const pageSize = Math.min(Math.max(Number(params.get('pageSize')) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(Number(params.get('page')) || 1, 1), pageCount);

  const response: MediaAnalysisFilesResponse = {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
    options,
  };
  return NextResponse.json(response);
}

export const GET = withApiLogging(getHandler, 'api/insights/media-analysis/files');
