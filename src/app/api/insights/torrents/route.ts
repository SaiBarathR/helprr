import { NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import type { InsightsTorrentsResponse } from '@/types/insights';
import { withApiLogging } from '@/lib/api-logger';

const TOP_N = 5;
const SEEDING_STATES = new Set(['uploading', 'stalledUP', 'queuedUP', 'forcedUP', 'checkingUP']);

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('insights.view');
  if (!auth.ok) return auth.response;
  if (!can(auth.user, 'torrents.view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const client = await getQBittorrentClient();
    const torrents = await client.getTorrents();

    let totalUploaded = 0;
    let totalDownloaded = 0;
    let seeding = 0;
    let belowRatio1 = 0;
    for (const t of torrents) {
      totalUploaded += t.uploaded ?? 0;
      totalDownloaded += t.downloaded ?? 0;
      if (SEEDING_STATES.has(t.state)) seeding += 1;
      if (t.progress >= 1 && (t.ratio ?? 0) < 1) belowRatio1 += 1;
    }

    const topUploaded = [...torrents]
      .filter((t) => (t.uploaded ?? 0) > 0)
      .sort((a, b) => (b.uploaded ?? 0) - (a.uploaded ?? 0))
      .slice(0, TOP_N)
      .map((t) => ({ name: t.name, uploaded: t.uploaded ?? 0, ratio: t.ratio ?? 0 }));

    const response: InsightsTorrentsResponse = {
      count: torrents.length,
      seeding,
      totalUploaded,
      totalDownloaded,
      overallRatio: totalDownloaded > 0 ? totalUploaded / totalDownloaded : null,
      belowRatio1,
      topUploaded,
    };
    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: 'qBittorrent unavailable' }, { status: 502 });
  }
}

export const GET = withApiLogging(getHandler, 'api/insights/torrents');
