import axios from 'axios';
import {
  checkOutboundUrl,
  createGuardedLookup,
  OUTBOUND_ADDRESS_MESSAGE,
  OutboundAddressError,
  PRIVATE_ADDRESS_MESSAGE,
  type OutboundRules,
} from '@/lib/outbound-url';

/**
 * Fetches a .torrent from an http(s) link a user pasted or shared, so the add
 * route learns its info hash before qBittorrent sees it: that is what lets it
 * say "already there", confirm the add, and offer Choose Files. qBittorrent's
 * own `urls=` fetch reports nothing back (it answers "Ok." and drops a failed
 * download quietly), so it is not used for links.
 *
 * The server making a request a user named is the risk here, so the addresses
 * follow the notification channels' rules (`src/lib/outbound-url.ts`), the
 * caller passing `{ allowPrivate: user.role === 'admin' }`: an admin may fetch
 * from the LAN (a Prowlarr or Jackett at home), anyone else from public
 * addresses only. Never a link-local, metadata or reserved address. Checked on
 * the name as written and on every address it resolves to, at connect time, so
 * a rebinding name can't slip through. http and https only, no proxy, at most
 * three redirects, each one checked the same way under the same rules (a
 * redirect to a magnet link is the magnet; to any other scheme it fails), a 15
 * second deadline for the whole chain, and a 10 MB cap on the body. Nothing is
 * sent but the URL: no cookie, no credential.
 *
 * Errors are fixed phrases: a link can carry a passkey, so neither it nor
 * anything the far end answered is ever put in one.
 */
export class TorrentLinkError extends Error {}

export type FetchedTorrentLink =
  | { kind: 'file'; bytes: Uint8Array<ArrayBuffer> }
  | { kind: 'magnet'; magnet: string };

const adminLookup = createGuardedLookup({ allowPrivate: true });
const memberLookup = createGuardedLookup({ allowPrivate: false });
const MAX_REDIRECTS = 3;
const FETCH_DEADLINE_MS = 15_000;
// Real .torrent files are kilobytes to a few MB; a big season pack with small pieces stays well under this.
export const MAX_LINKED_TORRENT_BYTES = 10 * 1024 * 1024;

/** A member's link to the LAN, loopback or this server. */
export const PRIVATE_LINK_MESSAGE = 'Members can add links from the internet only, not from an address on your own network';
/** Refused for everyone, admins too. */
export const BLOCKED_LINK_MESSAGE = 'Helprr does not fetch links from this address (a cloud metadata, link-local or reserved address)';

/** The link phrase for an address refusal from outbound-url, or null for any other error. */
function addressRefusal(message: string): string | null {
  if (message === PRIVATE_ADDRESS_MESSAGE) return PRIVATE_LINK_MESSAGE;
  if (message === OUTBOUND_ADDRESS_MESSAGE) return BLOCKED_LINK_MESSAGE;
  return null;
}

/** The checked URL, or why it is refused; for the link as typed and for each redirect. */
export function checkTorrentLink(raw: string, rules: OutboundRules): { ok: true; url: URL } | { ok: false; error: string } {
  const checked = checkOutboundUrl(raw, rules);
  if (checked.ok) return checked;
  let url: URL | null = null;
  try {
    url = new URL(raw.trim());
  } catch {
    // Reported below.
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return { ok: false, error: 'Enter a magnet link or an http(s) link to a .torrent file' };
  }
  if (url.username || url.password) return { ok: false, error: 'Leave the user name and password out of the link' };
  if (raw.trim().length > 2048) return { ok: false, error: 'The link is too long' };
  return { ok: false, error: addressRefusal(checked.error) ?? BLOCKED_LINK_MESSAGE };
}

function findCause<T extends Error>(error: unknown, type: new (...args: never[]) => T): T | null {
  for (let cause = error, depth = 0; cause && depth < 5; depth += 1) {
    if (cause instanceof type) return cause;
    cause = (cause as { cause?: unknown }).cause;
  }
  return null;
}

function failureMessage(error: unknown): string {
  if (error instanceof TorrentLinkError) return error.message;
  const refused = findCause(error, OutboundAddressError);
  if (refused) return addressRefusal(refused.message) ?? BLOCKED_LINK_MESSAGE;
  const err = error as { code?: string; name?: string; message?: string };
  const code = typeof err?.code === 'string' ? err.code : '';
  if (code === 'ERR_BAD_RESPONSE' && /maxContentLength/i.test(err.message ?? '')) return 'The link gave a file over 10 MB';
  if (['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED', 'ESOCKETTIMEDOUT'].includes(code) || err?.name === 'AbortError' || err?.name === 'TimeoutError' || err?.name === 'CanceledError') {
    return 'The link did not answer within 15 seconds';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return "The link's server name was not found";
  if (code === 'ECONNREFUSED') return "The link's server refused the connection";
  if (/CERT|SSL|TLS/i.test(code)) return "The link's server has no valid certificate";
  return "Could not reach the link's server";
}

/** True for the refusals that are the user's link, not the far end failing. */
export function isRefusedLink(message: string): boolean {
  return message === PRIVATE_LINK_MESSAGE || message === BLOCKED_LINK_MESSAGE;
}

export async function fetchTorrentLink(raw: string, rules: OutboundRules): Promise<FetchedTorrentLink> {
  const signal = AbortSignal.timeout(FETCH_DEADLINE_MS);
  let current = raw;
  try {
    for (let hop = 0; ; hop += 1) {
      const checked = checkTorrentLink(current, rules);
      if (!checked.ok) throw new TorrentLinkError(checked.error);
      const response = await axios.get<ArrayBuffer>(checked.url.toString(), {
        headers: { 'User-Agent': 'Helprr', Accept: 'application/x-bittorrent, */*;q=0.5' },
        responseType: 'arraybuffer',
        timeout: FETCH_DEADLINE_MS,
        signal,
        lookup: (rules.allowPrivate ? adminLookup : memberLookup) as never,
        // Followed here instead, so each hop is checked and a magnet: target is kept.
        maxRedirects: 0,
        maxContentLength: MAX_LINKED_TORRENT_BYTES,
        proxy: false,
        validateStatus: () => true,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (typeof location !== 'string' || !location) throw new TorrentLinkError('The link redirected nowhere');
        if (/^magnet:\?/i.test(location.trim())) return { kind: 'magnet', magnet: location.trim() };
        if (hop >= MAX_REDIRECTS) throw new TorrentLinkError('The link redirected too many times');
        let next: URL;
        try {
          next = new URL(location, checked.url);
        } catch {
          throw new TorrentLinkError('The link redirected to an address that could not be read');
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          throw new TorrentLinkError('The link redirected to something other than a web address');
        }
        current = next.toString();
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new TorrentLinkError(`The link refused the download (HTTP ${response.status}); it may need you to be signed in to the site`);
      }
      if (response.status < 200 || response.status >= 300) throw new TorrentLinkError(`The link answered HTTP ${response.status}`);
      return { kind: 'file', bytes: new Uint8Array(response.data) };
    }
  } catch (error) {
    throw new TorrentLinkError(failureMessage(error));
  }
}
