import { NextRequest, NextResponse } from 'next/server';
import type { QBittorrentClient } from '@/lib/qbittorrent-client';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { MagnetParseError, parseMagnetInfoHash } from '@/lib/magnet';
import { logApiDuration } from '@/lib/server-perf';

const MAGNET_VERIFY_TIMEOUT_MS = 5000;
const MAGNET_VERIFY_INTERVAL_MS = 500;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
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

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
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
