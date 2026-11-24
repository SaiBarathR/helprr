import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { can } from '@/lib/permissions';
import {
  BoundedBodyError,
  boundedBodyErrorResponse,
  readBoundedFormData,
} from '@/lib/server/bounded-body';
import {
  keepSharedTorrents,
  MAX_SHARED_TORRENT_BYTES,
  MAX_SHARED_TORRENT_FILES,
  type SharedTorrentFile,
} from '@/lib/share/shared-torrents';
import { parseTorrentInfoHash } from '@/lib/torrent-metainfo';

const SHARE_BODY_MAX_BYTES = 16 * 1024;
// The manifest offers Helprr for .torrent files (its `torrent` file field), so
// a signed-in user's share is read with room for one; only a user who may add
// torrents has it kept, anyone else gets the text flow. Signed out, the text
// limit stays.
const SHARE_WITH_TORRENTS_MAX_BYTES = SHARE_BODY_MAX_BYTES + MAX_SHARED_TORRENT_BYTES;
const SHARE_TITLE_MAX_CODE_POINTS = 256;
const SHARE_TEXT_MAX_BYTES = 2_048;
const SHARE_URL_MAX_BYTES = 2_048;
const SHARE_REDIRECT_QUERY_MAX_BYTES = 8 * 1024;
const SHARE_REDIRECT_LOCATION_MAX_BYTES = 8 * 1024;

/**
 * 303 to a *relative* Location.
 *
 * The obvious `new URL(target, request.url)` is wrong here. In a standalone
 * build `request.url` carries the server's own bind address rather than the
 * host that was asked, so a link shared into the installed Android PWA
 * redirected to `http://0.0.0.0:3050/login`: the payload survived intact and
 * the user landed on an unreachable host. Reading `x-forwarded-host` would
 * fix the host but makes the Location a caller-supplied value. A relative
 * reference is resolved by the browser against the origin it actually
 * requested, so it is same-origin by construction and needs no proxy headers
 * at all -- which is how the proxy already emits its own /login redirects.
 */
function redirectOrPayloadTooLarge(target: string): NextResponse {
  if (Buffer.byteLength(target, 'utf8') > SHARE_REDIRECT_LOCATION_MAX_BYTES) {
    return NextResponse.json(
      { error: 'Shared payload is too large' },
      { status: 413 },
    );
  }
  return new NextResponse(null, { status: 303, headers: { location: target } });
}

/**
 * Receives the POST from the Web Share Target action declared in
 * `manifest.json` (which is fixed to `method: POST`, `enctype:
 * multipart/form-data`). We read the shared fields and forward to `/share`
 * for the resolution UI. iOS Shortcuts and manual URL flows don't hit this
 * route — they go to `/protocol` or `/share` directly with query params.
 *
 * We don't resolve here — that happens server-side on the /share page —
 * because /share is auth-gated by the proxy and can render rich UI on
 * the result, whereas this route just exists to satisfy the manifest
 * spec (which insists on POST for the share-target action).
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  let params: URLSearchParams;
  let torrents: SharedTorrentFile[];
  try {
    ({ params, torrents } = await readShared(request, auth.ok, auth.ok && can(auth.user, 'torrents.add')));
  } catch (error) {
    const response = boundedBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const query = params.toString();
  if (Buffer.byteLength(query, 'utf8') > SHARE_REDIRECT_QUERY_MAX_BYTES) {
    return NextResponse.json(
      { error: 'Shared payload is too large' },
      { status: 413 },
    );
  }

  if (!auth.ok) {
    // Preserve the shared payload across the login round-trip so the user
    // doesn't lose context: send them to /login?next=/share?...
    const next = `/share?${query}`;
    return redirectOrPayloadTooLarge(`/login?next=${encodeURIComponent(next)}`);
  }

  // .torrent files open Torrents -> Add with them; a magnet or .torrent link
  // in the text is routed there by the /share page (also after a sign-in).
  if (torrents.length > 0) {
    await keepSharedTorrents(auth.user.id, torrents);
    return redirectOrPayloadTooLarge('/torrents/add?shared=files');
  }

  return redirectOrPayloadTooLarge(`/share?${query}`);
}

/** The shared files that parse as torrents (anything else shared is left to the text flow). */
function sharedTorrentFiles(form: FormData): Promise<SharedTorrentFile[]> {
  const files = form.getAll('torrent').filter((entry): entry is File => entry instanceof File).slice(0, MAX_SHARED_TORRENT_FILES);
  return Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })))
    .then((read) => read.filter(({ bytes }) => {
      try {
        parseTorrentInfoHash(bytes);
        return true;
      } catch {
        return false;
      }
    }));
}

async function readShared(
  request: NextRequest,
  signedIn: boolean,
  keepTorrents: boolean,
): Promise<{ params: URLSearchParams; torrents: SharedTorrentFile[] }> {
  const form = await readBoundedFormData(request, signedIn ? SHARE_WITH_TORRENTS_MAX_BYTES : SHARE_BODY_MAX_BYTES);
  const params = new URLSearchParams();
  const title = form.get('title');
  const text = form.get('text');
  const url = form.get('url');

  if (typeof title === 'string' && [...title].length > SHARE_TITLE_MAX_CODE_POINTS) {
    throw new BoundedBodyError(413, 'Shared payload is too large');
  }
  if (typeof text === 'string' && Buffer.byteLength(text, 'utf8') > SHARE_TEXT_MAX_BYTES) {
    throw new BoundedBodyError(413, 'Shared payload is too large');
  }
  if (typeof url === 'string' && Buffer.byteLength(url, 'utf8') > SHARE_URL_MAX_BYTES) {
    throw new BoundedBodyError(413, 'Shared payload is too large');
  }

  if (typeof title === 'string' && title) params.set('title', title);
  if (typeof text === 'string' && text) params.set('text', text);
  if (typeof url === 'string' && url) params.set('url', url);

  return { params, torrents: keepTorrents ? await sharedTorrentFiles(form) : [] };
}

export const POST = withApiLogging(postHandler, 'api/share', { logBodies: false });
