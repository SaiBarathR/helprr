import type { DownloadClient } from '@/types';

/**
 * Where a file qBittorrent wrote is on Sonarr/Radarr's side. Arr may run
 * elsewhere (Docker, another machine, Windows) and sees the download folder
 * through its own remote path mappings. Helprr never trusts a translation
 * blindly: each candidate is checked against Arr's own folder listing.
 */

export interface RemotePathMapping {
  host: string;
  remotePath: string;
  localPath: string;
}

export interface ArrPathCandidate {
  path: string;
  /** The mapping used, as Arr has it; null when the path is used unchanged. */
  mapping: { host: string; remotePath: string; localPath: string } | null;
}

const isWindows = (path: string) => /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');

/** Comparable form: forward slashes, a trailing slash, case-folded for Windows paths. */
function comparable(path: string, folder: boolean): string {
  let out = path.replace(/\\/g, '/');
  if (folder && !out.endsWith('/')) out += '/';
  return isWindows(path) ? out.toLowerCase() : out;
}

/** Whether two paths name the same file: case matters, except on Windows. */
export function samePath(a: string, b: string): boolean {
  return comparable(a.normalize('NFC'), false) === comparable(b.normalize('NFC'), false);
}

const fieldOf = (client: DownloadClient, name: string) => client.fields?.find((field) => field.name === name)?.value;

/**
 * The host Arr knows Helprr's qBittorrent by, which is what its remote path
 * mappings are keyed on (Arr applies a mapping only to its own host): the
 * qBittorrent client in Arr at Helprr's qBittorrent address, else Arr's only
 * qBittorrent host. Null when Arr has no qBittorrent client, or several hosts
 * and none at that address; `ambiguous` tells the two apart.
 */
export function qbittorrentHostInArr(clients: DownloadClient[], qbittorrentUrl: string | null): { host: string | null; ambiguous: boolean } {
  const qbittorrents = clients.filter((client) => client.implementation === 'QBittorrent' && typeof fieldOf(client, 'host') === 'string');
  const hosts = [...new Set(qbittorrents.map((client) => String(fieldOf(client, 'host')).toLowerCase()))];
  if (qbittorrentUrl) {
    try {
      const url = new URL(qbittorrentUrl);
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      const exact = qbittorrents.find((client) => String(fieldOf(client, 'host')).toLowerCase() === url.hostname.toLowerCase() && Number(fieldOf(client, 'port')) === port);
      if (exact) return { host: String(fieldOf(exact, 'host')), ambiguous: false };
    } catch {
      // Not a URL: fall back to Arr's only qBittorrent host.
    }
  }
  if (hosts.length === 1) return { host: String(fieldOf(qbittorrents[0], 'host')), ambiguous: false };
  return { host: null, ambiguous: hosts.length > 1 };
}

/** Join a folder and a relative path in the folder's own separator style. */
export function joinPath(folder: string, relative: string): string {
  const separator = isWindows(folder) && !folder.includes('/') ? '\\' : '/';
  const base = folder.endsWith('/') || folder.endsWith('\\') ? folder.slice(0, -1) : folder;
  return `${base}${separator}${relative.replace(/^[\\/]+/, '').replace(/[\\/]/g, separator)}`;
}

/**
 * Every way a download-client path may read on Arr's side, most specific first:
 * the remote path mappings for qBittorrent's host whose remote path contains it
 * (longest first), then the path unchanged (same machine, or the same mount on
 * both sides). Mappings for other hosts are other clients' trees.
 */
export function arrPathCandidates(clientPath: string, mappings: RemotePathMapping[], host: string | null): ArrPathCandidate[] {
  // As a folder too, so a mapping matches the folder it names.
  const target = comparable(clientPath, true);
  const matching = mappings
    .filter((mapping) => host !== null && mapping.host?.toLowerCase() === host.toLowerCase())
    .filter((mapping) => mapping.remotePath && mapping.localPath && target.startsWith(comparable(mapping.remotePath, true)))
    .sort((a, b) => comparable(b.remotePath, true).length - comparable(a.remotePath, true).length);
  const candidates: ArrPathCandidate[] = matching.map((mapping) => ({
    path: joinPath(mapping.localPath, clientPath.replace(/\\/g, '/').slice(comparable(mapping.remotePath, true).length)),
    mapping: { host: mapping.host, remotePath: mapping.remotePath, localPath: mapping.localPath },
  }));
  candidates.push({ path: clientPath, mapping: null });
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = comparable(candidate.path, false);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Apply a mapping chosen earlier, so every file of a download is translated the same way. */
export function applyMapping(clientPath: string, mapping: { remotePath: string; localPath: string } | null): string {
  if (!mapping) return clientPath;
  const prefix = comparable(mapping.remotePath, true);
  if (!comparable(clientPath, true).startsWith(prefix)) return clientPath;
  return joinPath(mapping.localPath, clientPath.replace(/\\/g, '/').slice(prefix.length));
}

/** The folder and file name of a path, in either separator style. */
export function splitPath(path: string): { folder: string; name: string } {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return { folder: path.slice(0, index + 1), name: path.slice(index + 1) };
}
