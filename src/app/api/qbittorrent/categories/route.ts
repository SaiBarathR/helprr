import { NextRequest, NextResponse } from 'next/server';
import { isAxiosError } from 'axios';
import type { User } from '@prisma/client';
import type { QBittorrentClient } from '@/lib/qbittorrent-client';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAdmin, requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { readJsonBody } from '@/lib/bulk-editor';
import { logger } from '@/lib/logger';
import { bumpQbitCacheVersion } from '@/lib/cache/qbittorrent-version';
import { CONTROL_CHARACTERS, isInsideFolder, parseLocation, parseNewCategoryName } from '@/lib/qbittorrent-inputs';
import { findArrCategoryUses } from '@/lib/qbittorrent-category-usage';

const ROUTE = '/api/qbittorrent/categories';
const MAX_REMOVE = 50;

async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    // details=1 is the Categories screen: what an empty save path means, and whether "/" makes a subcategory.
    if (request.nextUrl.searchParams.get('details') === '1') {
      const [categories, defaultSavePath, subcategories] = await Promise.all([
        client.getCategories(),
        client.getDefaultSavePath(),
        client.isSubcategoriesEnabled(),
      ]);
      logApiDuration(ROUTE, startedAt, { method: 'GET', details: true });
      return NextResponse.json({ categories, defaultSavePath, subcategories });
    }
    const categories = await client.getCategories();
    logApiDuration(ROUTE, startedAt, { method: 'GET' });
    return NextResponse.json(categories);
  } catch (error) {
    console.error('Failed to fetch categories:', error);
    logApiDuration(ROUTE, startedAt, { method: 'GET', failed: true });
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

/**
 * The save path to send: empty for qBittorrent's default (<default>/<name>),
 * else a folder inside qBittorrent's default save path. Every category's folder
 * becomes a download root that set-location and add accept, so one outside it
 * would widen what a member with those grants may write to. `current` (an
 * edit's present path) passes unchanged: keeping it widens nothing.
 */
async function checkSavePath(
  client: QBittorrentClient,
  value: unknown,
  current?: string,
): Promise<{ ok: true; savePath: string } | { ok: false; response: NextResponse }> {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return { ok: true, savePath: '' };
  }
  const savePath = parseLocation(value);
  if (!savePath) return { ok: false, response: badRequest('Enter a folder path') };
  if (current !== undefined && savePath === current) return { ok: true, savePath };
  const root = await client.getDefaultSavePath();
  if (!isInsideFolder(savePath, root)) {
    return {
      ok: false,
      response: badRequest(`The save path must be inside qBittorrent's default save path (${root})`),
    };
  }
  return { ok: true, savePath };
}

/** qBittorrent answers 409 when it won't make or change one (taken, or a name it refuses). */
function refusedResponse(error: unknown, fallback: string): NextResponse {
  if (isAxiosError(error) && error.response?.status === 409) {
    return NextResponse.json({ error: 'qBittorrent refused the category' }, { status: 409 });
  }
  return upstreamErrorResponse(error, fallback);
}

// Category changes are not torrent or file operations, and the operation audit
// has no kind for them (adding one needs a migration): the log keeps who did what.
function logChange(user: User, message: string, details: Record<string, unknown>) {
  logger.info(message, { userId: user.id, username: user.username, ...details }, { scope: 'qbittorrent' });
}

async function postHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const json = await readJsonBody(request);
    if (!json.ok || !json.body || typeof json.body !== 'object') return badRequest('Malformed JSON');
    const body = json.body as Record<string, unknown>;

    const client = await getQBittorrentClient();
    const [categories, subcategories] = await Promise.all([client.getCategories(), client.isSubcategoriesEnabled()]);
    const parsed = parseNewCategoryName(body.name, subcategories);
    if (!parsed.ok) return badRequest(parsed.error);
    if (Object.hasOwn(categories, parsed.name)) {
      return NextResponse.json({ error: `There is already a category named ${parsed.name}` }, { status: 409 });
    }
    const savePath = await checkSavePath(client, body.savePath);
    if (!savePath.ok) return savePath.response;

    await client.createCategory(parsed.name, savePath.savePath);
    await bumpQbitCacheVersion();
    logChange(auth.user, 'qBittorrent category created', { category: parsed.name, savePath: savePath.savePath });
    logApiDuration(ROUTE, startedAt, { method: 'POST' });
    return NextResponse.json({ success: true, name: parsed.name });
  } catch (error) {
    logApiDuration(ROUTE, startedAt, { method: 'POST', failed: true });
    return refusedResponse(error, 'Failed to create the category');
  }
}

async function patchHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const json = await readJsonBody(request);
    if (!json.ok || !json.body || typeof json.body !== 'object') return badRequest('Malformed JSON');
    const body = json.body as Record<string, unknown>;

    // Both named: qBittorrent can't rename a category, and its edit sets the save path, empty or not.
    if (typeof body.name !== 'string' || typeof body.savePath !== 'string') return badRequest('Send the name and the save path');
    const name = body.name;

    const client = await getQBittorrentClient();
    const [categories, subcategories] = await Promise.all([client.getCategories(), client.isSubcategoriesEnabled()]);
    const existing = Object.hasOwn(categories, name) ? categories[name] : null;
    if (!existing) return NextResponse.json({ error: 'That category is no longer in qBittorrent' }, { status: 404 });
    const savePath = await checkSavePath(client, body.savePath, existing.savePath);
    if (!savePath.ok) return savePath.response;
    // An empty path saves in <default>/<name>: for a name made elsewhere (such as "../x") that is outside every download folder.
    if (!savePath.savePath && existing.savePath && !parseNewCategoryName(name, subcategories).ok) {
      return badRequest('This name would put its default folder outside the download folders: give it a save path');
    }

    await client.editCategory(name, savePath.savePath, existing.download_path);
    await bumpQbitCacheVersion();
    logChange(auth.user, 'qBittorrent category edited', {
      category: name,
      savePath: savePath.savePath,
      previousSavePath: existing.savePath,
    });
    logApiDuration(ROUTE, startedAt, { method: 'PATCH' });
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiDuration(ROUTE, startedAt, { method: 'PATCH', failed: true });
    return refusedResponse(error, 'Failed to save the category');
  }
}

async function deleteHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const json = await readJsonBody(request);
    if (!json.ok || !json.body || typeof json.body !== 'object') return badRequest('Malformed JSON');
    const body = json.body as Record<string, unknown>;
    const names = Array.isArray(body.categories) ? [...new Set(body.categories)] : [];
    if (
      names.length === 0 ||
      names.length > MAX_REMOVE ||
      !names.every((name): name is string => typeof name === 'string' && name !== '' && !CONTROL_CHARACTERS.test(name))
    ) {
      return badRequest(`Choose 1 to ${MAX_REMOVE} categories`);
    }

    const client = await getQBittorrentClient();
    const [categories, subcategories] = await Promise.all([client.getCategories(), client.isSubcategoriesEnabled()]);
    const missing = names.filter((name) => !Object.hasOwn(categories, name));
    if (missing.length > 0) {
      return NextResponse.json({ error: `Not in qBittorrent: ${missing.join(', ')}` }, { status: 404 });
    }

    // An arr whose download-client category is gone can't import (or tag) what it grabs.
    const usage = await findArrCategoryUses(names, subcategories);
    const atRisk = usage.uses.length > 0 || usage.unchecked.length > 0;
    if (atRisk && body.confirm !== true) {
      logApiDuration(ROUTE, startedAt, { method: 'DELETE', needsConfirm: true });
      return NextResponse.json(
        {
          error: usage.uses.length > 0
            ? 'Sonarr, Radarr or Lidarr uses this category: removing it stops their imports'
            : 'Some Sonarr, Radarr or Lidarr instances did not answer, so their use of this category is unknown',
          needsConfirm: true,
          uses: usage.uses,
          unchecked: usage.unchecked,
        },
        { status: 409 },
      );
    }

    await client.removeCategories(names);
    await bumpQbitCacheVersion();
    logChange(auth.user, 'qBittorrent categories removed', {
      categories: names,
      subcategories,
      ...(atRisk ? { confirmedArrUses: usage.uses, unchecked: usage.unchecked } : {}),
    });
    logApiDuration(ROUTE, startedAt, { method: 'DELETE', count: names.length });
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiDuration(ROUTE, startedAt, { method: 'DELETE', failed: true });
    return upstreamErrorResponse(error, 'Failed to remove the categories');
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/categories');
export const POST = withApiLogging(postHandler, 'api/qbittorrent/categories');
export const PATCH = withApiLogging(patchHandler, 'api/qbittorrent/categories');
export const DELETE = withApiLogging(deleteHandler, 'api/qbittorrent/categories');
