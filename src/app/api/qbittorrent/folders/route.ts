import { NextRequest, NextResponse } from 'next/server';
import { isAxiosError } from 'axios';
import type { Capability } from '@/lib/capabilities';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAdmin, requireAuth, requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import {
  absoluteRoots,
  cleanFolderPath,
  folderUnderRoots,
  getDownloadRoots,
  listableRoots,
  listedFolderName,
  parentFolder,
  parseLocation,
} from '@/lib/qbittorrent-inputs';

const ROUTE = '/api/qbittorrent/folders';
// A phone list longer than this is no help; past it the path is typed.
const MAX_FOLDERS = 500;

/**
 * What the picker is for, and the grant that action needs: listing the
 * qBittorrent host's folders is no smaller a grant than the action it serves.
 * null: an admin's (categories).
 */
const FOLDER_PURPOSES: Record<string, Capability | null> = {
  add: 'torrents.add',
  location: 'torrents.manage',
  category: null,
};

export interface FolderListing {
  /** The folder listed, as the save-path checks read it; null for the list of download folders. */
  path: string | null;
  /** The folder above, while it is still inside a download folder; null goes back to that list. */
  parent: string | null;
  /** Folder names in `path`, sorted (or, with no `path`, the download folders' full paths). */
  folders: string[];
  /** How many there were before the cap. */
  total: number;
  truncated: boolean;
}

/**
 * Lists the folders inside qBittorrent's download folders, for a save-path
 * field. Only inside them, read as setLocation and add read a path (#781): the
 * default save path and every category's, or for a category's own path only
 * the default save path, as the categories route requires. Names only, sorted
 * and capped. qBittorrent follows symbolic links and its API can't tell one
 * from a folder, so a link inside a download folder is listed like one; the
 * save-path checks read paths the same way.
 */
async function getHandler(request: NextRequest) {
  const purpose = request.nextUrl.searchParams.get('for') ?? '';
  if (!Object.hasOwn(FOLDER_PURPOSES, purpose)) {
    const authError = await requireAuth();
    if (authError) return authError;
    return NextResponse.json({ error: 'Unknown folder picker' }, { status: 400 });
  }
  const capability = FOLDER_PURPOSES[purpose];
  const auth = capability ? await requireUserCapability(capability) : await requireAdmin();
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const roots = absoluteRoots(purpose === 'category' ? [await client.getDefaultSavePath()] : await getDownloadRoots(client));

    const requested = request.nextUrl.searchParams.get('path');
    if (requested === null || requested === '') {
      const folders = listableRoots(roots);
      logApiDuration(ROUTE, startedAt, { method: 'GET', purpose, roots: folders.length });
      return NextResponse.json({ path: null, parent: null, folders, total: folders.length, truncated: false } satisfies FolderListing);
    }

    const location = parseLocation(requested);
    const found = location === null ? null : folderUnderRoots(location, roots);
    // Cleaning drops only empty and "." parts, but it is checked again: what is checked is what is listed.
    const folder = found && folderUnderRoots(cleanFolderPath(found.path), roots)
      ? { path: cleanFolderPath(found.path), windows: found.windows }
      : null;
    if (!folder) {
      logApiDuration(ROUTE, startedAt, { method: 'GET', purpose, validationFailed: true });
      return NextResponse.json(
        {
          error: purpose === 'category'
            ? "That folder is outside qBittorrent's default save path"
            : 'That folder is outside the download folders',
        },
        { status: 400 },
      );
    }

    let entries: unknown;
    try {
      // The path as checked, never as sent.
      entries = await client.getDirectoryContent(folder.path);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        // An older qBittorrent has no such endpoint: its web server answers a bare "Not Found".
        const unsupported = error.response.data === 'Not Found';
        logApiDuration(ROUTE, startedAt, { method: 'GET', purpose, missing: !unsupported, unsupported });
        return NextResponse.json(
          {
            error: unsupported
              ? "This qBittorrent can't list folders (it needs version 5). Type the path instead."
              : 'That folder is not there anymore',
          },
          { status: 404 },
        );
      }
      throw error;
    }
    if (!Array.isArray(entries)) throw new Error('qBittorrent sent no folder list');

    const names = [...new Set(entries.map((entry) => listedFolderName(entry, folder.path, folder.windows)))]
      .filter((name): name is string => name !== null)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const above = parentFolder(folder.path);
    const parent = above !== null && folderUnderRoots(above, roots) ? above : null;

    logApiDuration(ROUTE, startedAt, { method: 'GET', purpose, count: names.length });
    return NextResponse.json({
      path: folder.path,
      parent,
      folders: names.slice(0, MAX_FOLDERS),
      total: names.length,
      truncated: names.length > MAX_FOLDERS,
    } satisfies FolderListing);
  } catch (error) {
    logApiDuration(ROUTE, startedAt, { method: 'GET', purpose, failed: true });
    return upstreamErrorResponse(error, 'Failed to list the folders');
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/folders');
