import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import type { AddTorrentOptions, QBittorrentClient } from '@/lib/qbittorrent-client';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUser, requireUserCapability } from '@/lib/auth';
import type { Capability } from '@/lib/capabilities';
import { can } from '@/lib/permissions';
import { MagnetParseError, parseMagnetInfoHash } from '@/lib/magnet';
import { TorrentParseError, parseTorrentInfoHash } from '@/lib/torrent-metainfo';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { bumpQbitCacheVersion } from '@/lib/cache/qbittorrent-version';
import { upstreamErrorResponse } from '@/lib/api-error';
import { deleteTorrentsAudited, TORRENT_DELETE_REFUSALS } from '@/lib/file-audit';
import { isInsideDownloadRoots, parseAddTorrentOptions, parseLocation, parseShareLimits, parseTags } from '@/lib/qbittorrent-inputs';
import { projectTorrentsForSummary } from '@/lib/qbittorrent-summary';
import { boundedBodyErrorResponse, readBoundedFormData } from '@/lib/server/bounded-body';
import {
  checkTorrentLink,
  fetchTorrentLink,
  PRIVATE_LINK_MESSAGE,
  TorrentLinkError,
  type FetchedTorrentLink,
} from '@/lib/torrent-link-fetch';

const MAGNET_VERIFY_TIMEOUT_MS = 5000;
const MAGNET_VERIFY_INTERVAL_MS = 500;
// Real .torrent files top out around a few MB; bound the buffer we parse.
const MAX_TORRENT_FILE_BYTES = 25 * 1024 * 1024;
// What one add takes (qBittorrent itself has no cap): the request waits on every
// link's fetch and every confirmation.
const MAX_ADD_ITEMS = 20;
const LINK_FETCH_CONCURRENCY = 3;
// The proxy hands a route at most 10 MB of body (Next's proxyClientMaxBodySize,
// left at its default), so several files share that.
const MAX_ADD_FORM_BYTES = 10 * 1024 * 1024;

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
    case 'setLocation':
    case 'addTags':
    case 'removeTags':
    case 'topPrio':
    case 'increasePrio':
    case 'decreasePrio':
    case 'bottomPrio':
      return 'torrents.manage';
    default:
      return null;
  }
}

async function runTorrentAction(
  client: QBittorrentClient,
  body: Record<string, unknown>,
  user: User
): Promise<NextResponse | null> {
  const action = body.action;
  const requiredCap = actionCapability(action);
  if (!requiredCap) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  if (!can(user, requiredCap)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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
    case 'delete': {
      const outcome = await deleteTorrentsAudited(client, user, hash, booleanOr(body.deleteFiles, false));
      if (outcome !== 'deleted') {
        // The list may have changed (or a delete may have gone through): let the next read see it.
        await bumpQbitCacheVersion();
        const { status, ...refusal } = TORRENT_DELETE_REFUSALS[outcome];
        return NextResponse.json(refusal, { status });
      }
      break;
    }
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
    case 'setShareLimits': {
      const limits = parseShareLimits(body);
      if (!limits) return NextResponse.json({ error: 'Enter a valid ratio and seeding time for each limit' }, { status: 400 });
      await client.setShareLimits(hash, limits.ratioLimit, limits.seedingTimeLimit, limits.inactiveSeedingTimeLimit);
      break;
    }
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
    case 'setLocation': {
      const location = parseLocation(body.location);
      if (!location) return NextResponse.json({ error: 'Enter a folder path' }, { status: 400 });
      if (!(await isInsideDownloadRoots(client, location))) {
        return NextResponse.json({ error: 'Location must be inside a configured download folder' }, { status: 400 });
      }
      await client.setLocation(hash, location);
      break;
    }
    case 'addTags':
    case 'removeTags': {
      const tags = parseTags(body.tags);
      if (!tags) return NextResponse.json({ error: 'Each tag needs 1 to 100 characters and no comma' }, { status: 400 });
      if (action === 'addTags') await client.addTags(hash, tags);
      else await client.removeTags(hash, tags);
      break;
    }
    case 'topPrio':
    case 'increasePrio':
    case 'decreasePrio':
    case 'bottomPrio':
      if (!(await client.isQueueingEnabled())) {
        return NextResponse.json({ error: 'Queueing is off in qBittorrent' }, { status: 409 });
      }
      await client.moveInQueue(hash, action);
      break;
  }

  return null;
}

async function validateSavepath(client: QBittorrentClient, savepath: string): Promise<NextResponse | null> {
  if (await isInsideDownloadRoots(client, savepath)) return null;
  return NextResponse.json(
    { error: 'savepath must be inside a configured download folder' },
    { status: 400 }
  );
}

// qBittorrent creates a category it doesn't know, saving to <default save path>/<name>
// with ".." resolved, so under automatic management (asked for, or qBittorrent's
// default) "../x" would put the payload outside every download folder. A known
// category's folder is one of the download roots already.
async function validateCategory(client: QBittorrentClient, category: string): Promise<NextResponse | null> {
  if (Object.hasOwn(await client.getCategories(), category)) return null;
  return NextResponse.json({ error: "category must be one of qBittorrent's categories" }, { status: 400 });
}

/** The add options a user may set, and that go together; null when they pass. */
function checkAddOptions(user: User, options: AddTorrentOptions, savepath: string | undefined): NextResponse | null {
  // Speed limits are their own grant on an existing torrent; adding one doesn't skip it.
  if ((options.dlLimit || options.upLimit) && !can(user, 'torrents.bandwidth')) {
    return NextResponse.json({ error: 'You may not set speed limits' }, { status: 403 });
  }
  // qBittorrent would drop the save path quietly: automatic management takes the category's folder.
  if (options.autoTMM === true && savepath) {
    return NextResponse.json(
      { error: 'Automatic management picks the folder: leave the save path empty' },
      { status: 400 }
    );
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

/** The added hashes qBittorrent lists within the deadline, each with its name. */
async function waitForTorrentHashes(client: QBittorrentClient, hashes: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const deadline = Date.now() + MAGNET_VERIFY_TIMEOUT_MS;

  while (hashes.length > 0 && Date.now() <= deadline) {
    const missing = hashes.filter((hash) => !found.has(hash));
    const torrents = await client.getTorrents(undefined, undefined, undefined, undefined, missing.join('|'));
    for (const torrent of torrents) {
      const hash = String(torrent.hash ?? '').toLowerCase();
      if (missing.includes(hash)) found.set(hash, typeof torrent.name === 'string' ? torrent.name : '');
    }
    if (found.size === hashes.length) break;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(MAGNET_VERIFY_INTERVAL_MS, remainingMs)));
  }

  return found;
}

/** A torrent ready to hand to qBittorrent, its hash known. */
type AddSource =
  | { kind: 'magnet'; magnet: string; hash: string }
  | { kind: 'file'; bytes: Uint8Array<ArrayBuffer>; filename: string; hash: string; fetched: boolean };

/**
 * How one item ended. `status` (and `cause`, an error to rethrow) answer a
 * one-item add the way this route always has; several items get the list.
 */
type AddOutcome =
  | { result: 'added'; hash: string; name?: string }
  | { result: 'exists'; hash: string }
  | { result: 'failed'; error: string; status: number; cause?: unknown };

type SharedAddOptions = AddTorrentOptions & {
  category?: string;
  savepath?: string;
  paused?: boolean;
  stopCondition?: 'MetadataReceived' | 'FilesChecked';
};

function failed(error: string, status: number, cause?: unknown): AddOutcome {
  return { result: 'failed', error, status, cause };
}

/** At most `limit` of `run` at once, results in input order. */
async function mapWithLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  }));
  return results;
}

type AddLine = { kind: 'magnet'; magnet: string; hash: string } | { kind: 'link'; url: string };

/** The magnets and http(s) links, one per line; refused whole when a line is neither, so nothing is half-added. */
function parseAddLines(urls: string): { ok: true; lines: AddLine[] } | { ok: false; error: string } {
  const raw = urls.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (raw.length > MAX_ADD_ITEMS) return { ok: false, error: `Add at most ${MAX_ADD_ITEMS} torrents at once` };
  const lines: AddLine[] = [];
  for (const [index, line] of raw.entries()) {
    const where = raw.length > 1 ? `Line ${index + 1}: ` : '';
    if (/^https?:/i.test(line)) {
      const checked = checkTorrentLink(line);
      if (!checked.ok) return { ok: false, error: `${where}${checked.error}` };
      lines.push({ kind: 'link', url: checked.url.toString() });
      continue;
    }
    if (!/^magnet:/i.test(line)) return { ok: false, error: `${where}Enter a magnet link or an http(s) link to a .torrent file` };
    try {
      lines.push({ kind: 'magnet', magnet: line, hash: parseMagnetInfoHash(line).normalizedHexHash });
    } catch (error) {
      if (error instanceof MagnetParseError) return { ok: false, error: `${where}${error.message}` };
      throw error;
    }
  }
  return { ok: true, lines };
}

/** Fetch a link (see torrent-link-fetch for the limits) and learn its hash: a .torrent, or the magnet it redirected to. */
async function resolveLink(url: string): Promise<AddSource | AddOutcome> {
  let fetched: FetchedTorrentLink;
  try {
    fetched = await fetchTorrentLink(url);
  } catch (error) {
    if (!(error instanceof TorrentLinkError)) throw error;
    return failed(error.message, error.message === PRIVATE_LINK_MESSAGE ? 400 : 502);
  }
  try {
    if (fetched.kind === 'magnet') {
      return { kind: 'magnet', magnet: fetched.magnet, hash: parseMagnetInfoHash(fetched.magnet).normalizedHexHash };
    }
    return { kind: 'file', bytes: fetched.bytes, filename: 'link.torrent', hash: parseTorrentInfoHash(fetched.bytes), fetched: true };
  } catch (error) {
    if (error instanceof MagnetParseError) return failed('The link led to a magnet link without a usable hash', 502);
    if (error instanceof TorrentParseError) return failed('The link did not give a .torrent file', 502);
    throw error;
  }
}

/**
 * Add each torrent and confirm it by hash. Settled items pass through as they
 * are; a torrent qBittorrent has, or that came earlier in the same list, is
 * not added again.
 */
async function addTorrents(
  client: QBittorrentClient,
  items: Array<AddSource | AddOutcome>,
  options: SharedAddOptions,
): Promise<AddOutcome[]> {
  const outcomes: Array<AddOutcome | null> = items.map((item) => ('result' in item ? item : null));
  const seen = new Set<string>();
  const toCheck: Array<{ index: number; source: AddSource }> = [];
  items.forEach((item, index) => {
    if ('result' in item) return;
    if (seen.has(item.hash)) {
      outcomes[index] = failed('The same torrent is earlier in this list', 409);
      return;
    }
    seen.add(item.hash);
    toCheck.push({ index, source: item });
  });

  const existing = toCheck.length > 0
    ? new Set((await client.getTorrents(undefined, undefined, undefined, undefined, toCheck.map(({ source }) => source.hash).join('|')))
      .map((torrent) => String(torrent.hash ?? '').toLowerCase()))
    : new Set<string>();

  const sent: Array<{ index: number; hash: string }> = [];
  for (const { index, source } of toCheck) {
    if (existing.has(source.hash)) {
      outcomes[index] = { result: 'exists', hash: source.hash };
      continue;
    }
    try {
      if (source.kind === 'magnet') {
        const addResponse = normalizeAddResponse(await client.addMagnet(source.magnet, options));
        if (isExplicitAddFailure(addResponse)) {
          outcomes[index] = failed('qBittorrent rejected the magnet link', 502);
          continue;
        }
        if (!isSuccessfulAddResponse(addResponse)) {
          outcomes[index] = failed('Unexpected qBittorrent add response', 502);
          continue;
        }
      } else {
        const { stopCondition, ...fileOptions } = options;
        // A fetched .torrent already has its metadata, so "stop once metadata
        // arrives" (asked for a link, which may have turned out to be a magnet)
        // means adding it stopped.
        await client.addTorrentFile(source.bytes, source.filename, source.fetched && stopCondition === 'MetadataReceived'
          ? { ...fileOptions, paused: true }
          : fileOptions);
      }
      sent.push({ index, hash: source.hash });
    } catch (error) {
      outcomes[index] = failed('qBittorrent did not take it', 502, error);
    }
  }

  const confirmed = await waitForTorrentHashes(client, sent.map(({ hash }) => hash));
  for (const { index, hash } of sent) {
    outcomes[index] = confirmed.has(hash)
      ? { result: 'added', hash, ...(confirmed.get(hash) ? { name: confirmed.get(hash) } : {}) }
      : failed('qBittorrent did not confirm the torrent within 5 seconds', 502);
  }
  if (sent.length > 0) await bumpQbitCacheVersion();
  return outcomes as AddOutcome[];
}

/**
 * One item answers as this route always has (200 with its hash, 409, or the
 * error with its status); several answer 200 with a result per item, in the
 * order sent (blank lines left out), which never repeats a link (it can carry
 * a passkey).
 */
function addResponse(outcomes: AddOutcome[]): NextResponse {
  if (outcomes.length === 1) {
    const [outcome] = outcomes;
    if (outcome.result === 'added') {
      return NextResponse.json({ success: true, hash: outcome.hash, ...(outcome.name ? { name: outcome.name } : {}) });
    }
    if (outcome.result === 'exists') return NextResponse.json({ error: 'Torrent already exists' }, { status: 409 });
    if (outcome.cause !== undefined) throw outcome.cause;
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json({
    results: outcomes.map((outcome, index) => outcome.result === 'failed'
      ? { index, result: 'failed', error: outcome.error }
      : outcome.result === 'added'
        ? { index, result: 'added', hash: outcome.hash, ...(outcome.name ? { name: outcome.name } : {}) }
        : { index, result: 'exists', hash: outcome.hash }),
  });
}

async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || undefined;
    const category = searchParams.get('category') || undefined;
    const sort = searchParams.get('sort') || undefined;
    const reverse = searchParams.get('reverse') === 'true' ? true : undefined;
    // qBittorrent's own `hashes` filter ('|'-separated), so a single-torrent
    // view doesn't have to download the whole list.
    const hashes = searchParams.get('hashes') || undefined;
    const torrents = await client.getTorrents(filter, category, sort, reverse, hashes);
    logApiDuration('/api/qbittorrent', startedAt, {
      method: 'GET',
      torrentCount: torrents.length,
      filter: filter || 'all',
    });
    // The list's fields only: the magnet and tracker URL can carry a passkey.
    return NextResponse.json(projectTorrentsForSummary(torrents));
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
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      if (!can(auth.user, 'torrents.add')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      let formData: FormData;
      try {
        formData = await readBoundedFormData(request, MAX_ADD_FORM_BYTES);
      } catch (error) {
        const response = boundedBodyErrorResponse(error);
        if (response) return response;
        throw error;
      }
      const files = formData.getAll('file').filter((entry): entry is File => entry instanceof File);
      if (files.length === 0) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }
      if (files.length > MAX_ADD_ITEMS) {
        return NextResponse.json({ error: `Add at most ${MAX_ADD_ITEMS} torrents at once` }, { status: 400 });
      }
      if (files.some((file) => file.size > MAX_TORRENT_FILE_BYTES)) {
        return NextResponse.json({ error: 'Torrent file is too large' }, { status: 400 });
      }
      const category = formData.get('category') as string | null;
      const savepath = formData.get('savepath') as string | null;
      const paused = formData.get('paused') === 'true';

      const tagFields = formData.getAll('tags');
      const parsedOptions = parseAddTorrentOptions((field) =>
        field === 'tags' ? (tagFields.length > 0 ? tagFields : undefined) : formData.get(field)
      );
      if (!parsedOptions.ok) {
        logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'file', validationFailed: true });
        return NextResponse.json({ error: parsedOptions.error }, { status: 400 });
      }
      const optionsError = checkAddOptions(auth.user, parsedOptions.options, savepath || undefined);
      if (optionsError) {
        logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'file', validationFailed: true });
        return optionsError;
      }

      if (savepath) {
        const savepathError = await validateSavepath(client, savepath);
        if (savepathError) {
          logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'file', validationFailed: true });
          return savepathError;
        }
      }
      if (category) {
        const categoryError = await validateCategory(client, category);
        if (categoryError) {
          logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'file', validationFailed: true });
          return categoryError;
        }
      }

      const items: Array<AddSource | AddOutcome> = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        try {
          items.push({ kind: 'file', bytes, filename: file.name, hash: parseTorrentInfoHash(bytes), fetched: false });
        } catch (error) {
          if (!(error instanceof TorrentParseError)) throw error;
          items.push(failed(error.message, 400));
        }
      }

      const outcomes = await addTorrents(client, items, {
        ...parsedOptions.options,
        category: category || undefined,
        savepath: savepath || undefined,
        paused,
      });
      logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'file', count: files.length });
      return addResponse(outcomes);
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
      const actionResponse = await runTorrentAction(client, body, auth.user);
      if (actionResponse) {
        logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'action', action: body.action, status: actionResponse.status });
        return actionResponse;
      }
      // Bust the summary cache so the client's reconcile refetch sees post-action state.
      await bumpQbitCacheVersion();
      logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'action', action: body.action });
      return NextResponse.json({ success: true });
    }

    if (!can(auth.user, 'torrents.add')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const urls = body.urls;
    if (!isNonEmptyString(urls)) {
      logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'magnet', missingUrls: true });
      return NextResponse.json({ error: 'urls (magnet link) is required' }, { status: 400 });
    }

    const parsedLines = parseAddLines(urls);
    if (!parsedLines.ok) {
      logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'magnet', validationFailed: true });
      return NextResponse.json({ error: parsedLines.error }, { status: 400 });
    }

    const parsedOptions = parseAddTorrentOptions((field) => body[field]);
    if (!parsedOptions.ok) {
      logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'magnet', validationFailed: true });
      return NextResponse.json({ error: parsedOptions.error }, { status: 400 });
    }

    const category = isNonEmptyString(body.category) ? body.category.trim() : undefined;
    const savepath = isNonEmptyString(body.savepath) ? body.savepath.trim() : undefined;
    const paused = typeof body.paused === 'boolean' ? body.paused : undefined;

    const optionsError = checkAddOptions(auth.user, parsedOptions.options, savepath);
    if (optionsError) {
      logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'magnet', validationFailed: true });
      return optionsError;
    }

    if (savepath) {
      const savepathError = await validateSavepath(client, savepath);
      if (savepathError) {
        logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'magnet', validationFailed: true });
        return savepathError;
      }
    }
    if (category) {
      const categoryError = await validateCategory(client, category);
      if (categoryError) {
        logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'magnet', validationFailed: true });
        return categoryError;
      }
    }
    const stopCondition = body.stopCondition === 'MetadataReceived' || body.stopCondition === 'FilesChecked'
      ? body.stopCondition
      : undefined;

    // Links are fetched only once everything else has passed.
    const items = await mapWithLimit(parsedLines.lines, LINK_FETCH_CONCURRENCY, async (line) =>
      line.kind === 'link' ? resolveLink(line.url) : line
    );
    const outcomes = await addTorrents(client, items, {
      ...parsedOptions.options,
      category,
      savepath,
      paused,
      stopCondition,
    });
    logApiDuration('/api/qbittorrent', startedAt, {
      method: 'POST',
      mode: 'magnet',
      count: items.length,
      links: parsedLines.lines.filter((line) => line.kind === 'link').length,
    });
    return addResponse(outcomes);
  } catch (error) {
    logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', failed: true });
    return upstreamErrorResponse(error, 'Failed to add torrent');
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent');
export const POST = withApiLogging(postHandler, 'api/qbittorrent');
