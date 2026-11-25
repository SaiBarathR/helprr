import { NextRequest, NextResponse } from 'next/server';
import { isAxiosError } from 'axios';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { qbittorrentInstanceOf } from '@/lib/server/qbittorrent-instance';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { bumpQbitCacheVersion } from '@/lib/cache/qbittorrent-version';
import { upstreamErrorResponse } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { CONTROL_CHARACTERS, parseTorrentEntryName } from '@/lib/qbittorrent-inputs';
import { findArrCategoryUses } from '@/lib/qbittorrent-category-usage';

const ROUTE = '/api/qbittorrent/[hash]/files/rename';
// A v1 info hash (SHA-1) or a v2 one (SHA-256), in hex: not qBittorrent's `all` or a `|` list.
const SINGLE_TORRENT_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
// Linux PATH_MAX; a longer one is in no torrent.
const MAX_PATH_LENGTH = 4096;

/** Where an arr that downloads into this torrent's category may lose track of it. */
export interface RenameArrUse {
  app: string;
  /** The connection's label; only an admin is sent it (anyone else gets the app's name). */
  instance: string;
}

/*
 * Renames one file or folder inside a torrent, under torrents.manage like its
 * other settings. The body names the file or folder by its path in the torrent
 * (checked against the torrent's own file list) and gives the new NAME only;
 * the server puts it beside the old one, so a rename can't move anything out
 * of its folder or out of the torrent. A torrent in a category Sonarr, Radarr
 * or Lidarr downloads into needs `confirm`: the arr looks for the files by the
 * names it grabbed, so a rename can stop its import. Not operation-audited:
 * like the torrent's own rename and its location, nothing is deleted; the log
 * keeps who renamed what.
 */
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const auth = await requireUserCapability('torrents.manage');
  if (!auth.ok) return auth.response;
  const instance = await qbittorrentInstanceOf(request);
  if (!instance.ok) return instance.response;
  const startedAt = performance.now();

  const refuse = (status: number, error: string, reason: string, extra?: Record<string, unknown>) => {
    logApiDuration(ROUTE, startedAt, { method: 'POST', refused: reason });
    return NextResponse.json({ error, ...extra }, { status });
  };

  try {
    const { hash } = await params;
    if (!SINGLE_TORRENT_HASH.test(hash)) return refuse(400, 'Invalid torrent hash', 'hash');
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return refuse(400, 'malformed JSON', 'json');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'malformed JSON', 'json');
    const input = body as Record<string, unknown>;

    const kind = input.kind;
    if (kind !== 'file' && kind !== 'folder') return refuse(400, 'kind must be file or folder', 'kind');
    const oldPath = input.path;
    if (typeof oldPath !== 'string' || !oldPath || oldPath.length > MAX_PATH_LENGTH || CONTROL_CHARACTERS.test(oldPath)) {
      return refuse(400, 'Name the file or folder by its path in the torrent', 'path');
    }
    const parsed = parseTorrentEntryName(input.name);
    if (!parsed.ok) return refuse(400, parsed.error, 'name');

    const client = await getQBittorrentClient(instance.instanceId);
    const [files, torrents] = await Promise.all([
      client.getTorrentFiles(hash),
      client.getTorrents(undefined, undefined, undefined, undefined, hash),
    ]);
    const torrent = torrents.find((entry) => entry.hash?.toLowerCase() === hash.toLowerCase());
    if (!torrent) return refuse(404, 'This torrent is no longer in qBittorrent', 'torrent');

    // Exactly a path the torrent has: a file by its whole name, a folder as the start of one.
    const names = files.map((file) => file.name);
    const exists = kind === 'file' ? names.includes(oldPath) : names.some((name) => name.startsWith(`${oldPath}/`));
    if (!exists) return refuse(404, `That ${kind} is no longer in this torrent`, 'missing');

    const cut = oldPath.lastIndexOf('/');
    const newPath = cut >= 0 ? `${oldPath.slice(0, cut)}/${parsed.name}` : parsed.name;
    if (newPath === oldPath) return refuse(400, `That is already the ${kind}'s name`, 'unchanged');
    if (names.some((name) => name === newPath || name.startsWith(`${newPath}/`))) {
      return refuse(409, `There is already a file or folder named ${parsed.name} there`, 'taken');
    }

    const category = typeof torrent.category === 'string' ? torrent.category : '';
    let checkedArrUses: { uses: RenameArrUse[]; unchecked: string[] } | null = null;
    if (category) {
      // Only an exact match: an arr finds its downloads by its own category, not a parent's.
      const usage = await findArrCategoryUses([category], false);
      const uses = [...new Map(usage.uses.map((use) => [`${use.app}|${use.instance}`, { app: use.app, instance: use.instance }])).values()];
      if (uses.length > 0 || usage.unchecked.length > 0) {
        checkedArrUses = { uses, unchecked: usage.unchecked };
        if (input.confirm !== true) {
          // Connection labels are an admin's to see (other lists filter them by grant): anyone else gets the app's name.
          const admin = auth.user.role === 'admin';
          const shownUses = admin
            ? uses
            : [...new Set(uses.map((use) => use.app))].map((app) => ({ app, instance: app }));
          return refuse(
            409,
            uses.length > 0
              ? `Sonarr, Radarr or Lidarr downloads into ${category}: renaming can stop it importing this torrent`
              : `Some Sonarr, Radarr or Lidarr instances did not answer, so whether they use ${category} is unknown`,
            'needsConfirm',
            {
              needsConfirm: true,
              category,
              uses: shownUses,
              unchecked: admin ? usage.unchecked : [],
              someUnchecked: usage.unchecked.length > 0,
            },
          );
        }
      }
    }

    try {
      if (kind === 'file') await client.renameFile(hash, oldPath, newPath);
      else await client.renameFolder(hash, oldPath, newPath);
    } catch (error) {
      // Taken meanwhile, or a name qBittorrent's filesystem refuses.
      if (isAxiosError(error) && error.response?.status === 409) {
        return refuse(409, 'qBittorrent refused the new name', 'upstream');
      }
      throw error;
    }
    await bumpQbitCacheVersion(client.instanceId);
    logger.info(
      kind === 'file' ? 'Torrent file renamed' : 'Torrent folder renamed',
      {
        userId: auth.user.id,
        username: auth.user.username,
        hash,
        oldPath,
        newPath,
        ...(checkedArrUses ? { category, confirmedArrUses: checkedArrUses.uses, unchecked: checkedArrUses.unchecked } : {}),
      },
      { scope: 'qbittorrent' },
    );
    logApiDuration(ROUTE, startedAt, { method: 'POST', kind });
    return NextResponse.json({ success: true, path: newPath });
  } catch (error) {
    logApiDuration(ROUTE, startedAt, { method: 'POST', failed: true });
    return upstreamErrorResponse(error, 'Failed to rename');
  }
}

export const POST = withApiLogging(postHandler, 'api/qbittorrent/[hash]/files/rename');
