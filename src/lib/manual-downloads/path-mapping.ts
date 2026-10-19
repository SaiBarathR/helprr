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
  mapping: { remotePath: string; localPath: string } | null;
}

const isWindows = (path: string) => /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');

/** Comparable form: forward slashes, a trailing slash, case-folded for Windows paths. */
function comparable(path: string, folder: boolean): string {
  let out = path.replace(/\\/g, '/');
  if (folder && !out.endsWith('/')) out += '/';
  return isWindows(path) ? out.toLowerCase() : out;
}

/** Join a folder and a relative path in the folder's own separator style. */
export function joinPath(folder: string, relative: string): string {
  const separator = isWindows(folder) && !folder.includes('/') ? '\\' : '/';
  const base = folder.endsWith('/') || folder.endsWith('\\') ? folder.slice(0, -1) : folder;
  return `${base}${separator}${relative.replace(/^[\\/]+/, '').replace(/[\\/]/g, separator)}`;
}

/**
 * Every way a download-client path may read on Arr's side, most specific first:
 * the remote path mappings whose remote path contains it (longest first), then
 * the path unchanged (same machine, or the same mount on both sides).
 */
export function arrPathCandidates(clientPath: string, mappings: RemotePathMapping[]): ArrPathCandidate[] {
  // As a folder too, so a mapping matches the folder it names.
  const target = comparable(clientPath, true);
  const matching = mappings
    .filter((mapping) => mapping.remotePath && mapping.localPath && target.startsWith(comparable(mapping.remotePath, true)))
    .sort((a, b) => comparable(b.remotePath, true).length - comparable(a.remotePath, true).length);
  const candidates: ArrPathCandidate[] = matching.map((mapping) => ({
    path: joinPath(mapping.localPath, clientPath.replace(/\\/g, '/').slice(comparable(mapping.remotePath, true).length)),
    mapping: { remotePath: mapping.remotePath, localPath: mapping.localPath },
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
export function applyMapping(clientPath: string, mapping: ArrPathCandidate['mapping']): string {
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
