import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getMediaAnalysisDataset, computeQualityScore } from '@/lib/media-analysis';
import type {
  MediaAnalysisDistEntry,
  MediaAnalysisFile,
  MediaAnalysisResponse,
  MediaAnalysisUpgradeCandidate,
} from '@/types/insights';
import { withApiLogging } from '@/lib/api-logger';

const UPGRADE_CANDIDATES_N = 12;
const DIST_TOP_N = 6;

// Count + bytes per distinct value; top N by count, remainder folded into "Other".
function distribution(
  rows: MediaAnalysisFile[],
  value: (row: MediaAnalysisFile) => string | null,
): MediaAnalysisDistEntry[] {
  const byName = new Map<string, { count: number; bytes: number }>();
  for (const row of rows) {
    const name = value(row);
    if (!name) continue;
    const entry = byName.get(name) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += row.size;
    byName.set(name, entry);
  }
  const sorted = [...byName.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count);
  if (sorted.length <= DIST_TOP_N + 1) return sorted;
  const head = sorted.slice(0, DIST_TOP_N);
  const rest = sorted.slice(DIST_TOP_N);
  head.push({
    name: 'Other',
    count: rest.reduce((s, r) => s + r.count, 0),
    bytes: rest.reduce((s, r) => s + r.bytes, 0),
  });
  return head;
}

const HISTOGRAM_BUCKETS = ['0–19', '20–39', '40–59', '60–79', '80–100'];

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('insights.view');
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const kind = request.nextUrl.searchParams.get('kind'); // 'movie' | 'episode' | null (all)

  const dataset = await getMediaAnalysisDataset({
    movies: can(user, 'movies.view') && kind !== 'episode',
    series: can(user, 'series.view') && kind !== 'movie',
  });
  const rows = dataset.rows;

  let movies = 0;
  let episodes = 0;
  let bytes = 0;
  let bitrateSum = 0;
  let bitrateCount = 0;
  const histogram = HISTOGRAM_BUCKETS.map((bucket) => ({ bucket, count: 0 }));
  let scoreSum = 0;
  let scoredFiles = 0;
  for (const row of rows) {
    if (row.kind === 'movie') movies += 1;
    else episodes += 1;
    bytes += row.size;
    if (row.videoBitrate !== null) {
      bitrateSum += row.videoBitrate;
      bitrateCount += 1;
    }
    if (row.score !== null) {
      scoreSum += row.score;
      scoredFiles += 1;
      histogram[Math.min(Math.floor(row.score / 20), 4)].count += 1;
    }
  }

  // Weakest scored files; reasons recomputed only for these few.
  const upgradeCandidates: MediaAnalysisUpgradeCandidate[] = rows
    .filter((r): r is MediaAnalysisFile & { score: number } => r.score !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, UPGRADE_CANDIDATES_N)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      subtitle: r.subtitle,
      resolution: r.resolution,
      videoCodec: r.videoCodec,
      size: r.size,
      score: r.score,
      reasons: computeQualityScore(r).reasons,
      href: r.href,
    }));

  const response: MediaAnalysisResponse = {
    available: dataset.available,
    partial: dataset.partial,
    totals: {
      files: rows.length,
      bytes,
      movies,
      episodes,
      avgVideoBitrate: bitrateCount > 0 ? Math.round(bitrateSum / bitrateCount) : null,
      scoredFiles,
    },
    distributions: {
      videoCodec: distribution(rows, (r) => r.videoCodec),
      resolution: distribution(rows, (r) => r.resolution),
      dynamicRange: distribution(rows, (r) => r.dynamicRange),
      audioCodec: distribution(rows, (r) => r.audioCodec),
      audioChannels: distribution(rows, (r) => (r.audioChannels !== null ? `${r.audioChannels}ch` : null)),
      videoBitDepth: distribution(rows, (r) => (r.videoBitDepth !== null ? `${r.videoBitDepth}-bit` : null)),
    },
    quality: {
      avgScore: scoredFiles > 0 ? Math.round(scoreSum / scoredFiles) : null,
      histogram,
      upgradeCandidates,
    },
  };
  return NextResponse.json(response);
}

export const GET = withApiLogging(getHandler, 'api/insights/media-analysis');
