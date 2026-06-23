import { NextRequest, NextResponse } from 'next/server';
import type { QBittorrentClient } from '@/lib/qbittorrent-client';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import type { Capability } from '@/lib/capabilities';
import { MagnetParseError, parseMagnetInfoHash } from '@/lib/magnet';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';

const MAGNET_VERIFY_TIMEOUT_MS = 5000;
const MAGNET_VERIFY_INTERVAL_MS = 500;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

// Per-action capability: delete is the most destructive, bandwidth-limit changes
// are their own grant, everything else is general torrent management.
function actionCapability(action: unknown): Capability | null {
  switch (action) {
    case 'delete':
      return 'torrents.delete';
    case 'setDownloadLimit':
    case 'setUploadLimit':
    case 'setShareLimits':
      return 'torrents.bandwidth';
    case 'pause':
    case 'stop':
    case 'resume':
    case 'start':
    case 'forceStart':
    case 'toggleSequentialDownload':
    case 'toggleFirstLastPiecePrio':
    case 'setCategory':
    case 'recheck':
    case 'reannounce':
    case 'setAutoManagement':
    case 'rename':
      return 'torrents.manage';
    default:
      return null;
  }
}

async function runTorrentAction(client: QBittorrentClient, body: Record<string, unknown>): Promise<NextResponse | null> {
  const action = body.action;
  const requiredCap = actionCapability(action);
  if (!requiredCap) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  const capError = await requireCapability(requiredCap);
  if (capError) return capError;

  const hash = isNonEmptyString(body.hash) ? body.hash.trim() : '';
  if (!hash) return NextResponse.json({ error: 'hash is required' }, { status: 400 });

  switch (action) {
    case 'pause':
    case 'stop':
      await client.pauseTorrent(hash);
      break;
    case 'resume':
    case 'start':
      await client.resumeTorrent(hash);
      break;
    case 'delete':
      await client.deleteTorrent(hash, booleanOr(body.deleteFiles, false));
      break;
    case 'forceStart':
      await client.forceStartTorrent(hash);
      break;
    case 'setDownloadLimit':
      await client.setTorrentDownloadLimit(hash, numberOr(body.limit, 0));
      break;
    case 'setUploadLimit':
      await client.setTorrentUploadLimit(hash, numberOr(body.limit, 0));
      break;
    case 'toggleSequentialDownload':
      await client.toggleSequentialDownload(hash);
      break;
    case 'toggleFirstLastPiecePrio':
      await client.toggleFirstLastPiecePrio(hash);
      break;
    case 'setCategory':
      await client.setCategory(hash, typeof body.category === 'string' ? body.category : '');
      break;
    case 'setShareLimits':
      await client.setShareLimits(
        hash,
        numberOr(body.ratioLimit, -2),
        numberOr(body.seedingTimeLimit, -2),
        numberOr(body.inactiveSeedingTimeLimit, -2),
      );
      break;
    case 'recheck':
      await client.recheckTorrent(hash);
      break;
    case 'reannounce':
      await client.reannounceTorrent(hash);
      break;
    case 'setAutoManagement':
      await client.setAutoManagement(hash, booleanOr(body.enable, false));
      break;
    case 'rename':
      await client.renameTorrent(hash, typeof body.name === 'string' ? body.name : '');
      break;
  }

  return null;
}

function normalizeAddResponse(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isExplicitAddFailure(value: string): boolean {
  return /fail/i.test(value);
}

function isSuccessfulAddResponse(value: string): boolean {
  return value.length === 0 || /^ok\.?$/i.test(value);
}

async function waitForTorrentHash(client: QBittorrentClient, hash: string): Promise<boolean> {
  const deadline = Date.now() + MAGNET_VERIFY_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    const torrents = await client.getTorrents(undefined, undefined, undefined, undefined, hash);
    if (torrents.length > 0) {
      return true;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(MAGNET_VERIFY_INTERVAL_MS, remainingMs)));
  }

  return false;
}

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('torrents.view');
  if (capError) return capError;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || undefined;
    const category = searchParams.get('category') || undefined;
    const sort = searchParams.get('sort') || undefined;
    const reverse = searchParams.get('reverse') === 'true' ? true : undefined;
    const torrents = await client.getTorrents(filter, category, sort, reverse);
    logApiDuration('/api/qbittorrent', startedAt, {
      method: 'GET',
      torrentCount: torrents.length,
      filter: filter || 'all',
    });
    return NextResponse.json(torrents);
  } catch (error) {
    console.error('Failed to fetch torrents:', error);
    logApiDuration('/api/qbittorrent', startedAt, { method: 'GET', failed: true });
    return NextResponse.json(
      { error: 'Failed to fetch torrents' },
      { status: 500 }
    );
  }
}

async function postHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const capError = await requireCapability('torrents.add');
      if (capError) return capError;
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }
      const buffer = new Uint8Array(await file.arrayBuffer());
      const category = formData.get('category') as string | null;
      const savepath = formData.get('savepath') as string | null;
      const paused = formData.get('paused') === 'true';
      await client.addTorrentFile(buffer, file.name, {
        category: category || undefined,
        savepath: savepath || undefined,
        paused,
      });
      logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'file' });
      return NextResponse.json({ success: true });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'magnet', invalidJson: true });
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      throw error;
    }

    if (!rawBody || typeof rawBody !== 'object') {
      logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'magnet', invalidBody: true });
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const body = rawBody as Record<string, unknown>;
    if (body.action !== undefined) {
      const actionResponse = await runTorrentAction(client, body);
      if (actionResponse) return actionResponse;
      logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'action', action: body.action });
      return NextResponse.json({ success: true });
    }

    const capError = await requireCapability('torrents.add');
    if (capError) return capError;

    const urls = body.urls;
    if (!isNonEmptyString(urls)) {
      logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'magnet', missingUrls: true });
      return NextResponse.json({ error: 'urls (magnet link) is required' }, { status: 400 });
    }

    let normalizedHash: string;
    try {
      normalizedHash = parseMagnetInfoHash(urls).normalizedHexHash;
    } catch (error) {
      if (error instanceof MagnetParseError) {
        logApiDuration('/api/qbittorrent', startedAt, {
          method: 'POST',
          mode: 'magnet',
          validationFailed: true,
        });
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const existing = await client.getTorrents(undefined, undefined, undefined, undefined, normalizedHash);
    if (existing.length > 0) {
      logApiDuration('/api/qbittorrent', startedAt, {
        method: 'POST',
        mode: 'magnet',
        duplicate: true,
      });
      return NextResponse.json({ error: 'Torrent already exists' }, { status: 409 });
    }

    const category = isNonEmptyString(body.category) ? body.category.trim() : undefined;
    const savepath = isNonEmptyString(body.savepath) ? body.savepath.trim() : undefined;
    const paused = typeof body.paused === 'boolean' ? body.paused : undefined;

    const addResponseRaw = await client.addMagnet(urls.trim(), {
      category,
      savepath,
      paused,
    });
    const addResponse = normalizeAddResponse(addResponseRaw);
    if (isExplicitAddFailure(addResponse)) {
      logApiDuration('/api/qbittorrent', startedAt, {
        method: 'POST',
        mode: 'magnet',
        addRejected: true,
      });
      return NextResponse.json({ error: 'qBittorrent rejected the magnet link' }, { status: 502 });
    }
    if (!isSuccessfulAddResponse(addResponse)) {
      logApiDuration('/api/qbittorrent', startedAt, {
        method: 'POST',
        mode: 'magnet',
        addRejected: true,
      });
      return NextResponse.json({ error: 'Unexpected qBittorrent add response' }, { status: 502 });
    }

    const confirmed = await waitForTorrentHash(client, normalizedHash);
    if (!confirmed) {
      logApiDuration('/api/qbittorrent', startedAt, {
        method: 'POST',
        mode: 'magnet',
        verifyTimeout: true,
      });
      return NextResponse.json(
        { error: 'qBittorrent did not confirm the torrent within 5 seconds' },
        { status: 502 }
      );
    }

    logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'magnet' });
    return NextResponse.json({ success: true, hash: normalizedHash });
  } catch (error) {
    console.error('Failed to add torrent:', error);
    logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', failed: true });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add torrent' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent');
export const POST = withApiLogging(postHandler, 'api/qbittorrent');
