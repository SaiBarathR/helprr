// Media paths come from the *arr instance's host OS, so they may be POSIX
// (/mnt/media/X) or Windows (C:\Media\X, \\nas\media\X) style. Detect the style
// from the path itself rather than assuming '/'. Only a drive letter or a UNC
// prefix means Windows: a backslash is a legal character in a POSIX name.
function separatorOf(path: string): string {
  return /^[A-Za-z]:\\|^\\\\/.test(path) ? '\\' : '/';
}

/** A trailing separator does not start an empty final segment. */
function withoutTrailingSeparators(path: string, sep: string): string {
  let end = path.length;
  while (end > 1 && path[end - 1] === sep) end -= 1;
  return path.slice(0, end);
}

/** Parent directory of a media path, e.g. "C:\Movies\X (2026)" → "C:\Movies". */
export function parentPath(path: string): string {
  const sep = separatorOf(path);
  const parent = withoutTrailingSeparators(path, sep).split(sep).slice(0, -1).join(sep);
  // A drive or filesystem root keeps its separator: "C:\X" → "C:\", "/X" → "/".
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}${sep}`;
  if (parent === '' && path.startsWith(sep)) return sep;
  return parent;
}

/** Final segment of a media path, e.g. "/mnt/movies/X (2026)" → "X (2026)". */
export function lastPathSegment(path: string): string {
  const sep = separatorOf(path);
  return withoutTrailingSeparators(path, sep).split(sep).pop() ?? '';
}

/** Join a folder (root folder from the same instance) and a child segment using the folder's separator. */
export function joinPath(folder: string, segment: string): string {
  const sep = separatorOf(folder);
  return folder.endsWith(sep) ? `${folder}${segment}` : `${folder}${sep}${segment}`;
}

/**
 * The path a title moves to in another root folder, or null when that is the
 * folder it is already in (a trailing separator aside). An unchanged root must
 * leave the stored path exactly as it was: the API treats any other string as
 * a path change.
 */
export function pathInRootFolder(path: string, rootFolder: string): string | null {
  if (!rootFolder) return null;
  if (withoutTrailingSeparators(rootFolder, separatorOf(rootFolder)) === withoutTrailingSeparators(parentPath(path), separatorOf(path))) {
    return null;
  }
  const folder = lastPathSegment(path);
  return folder ? joinPath(rootFolder, folder) : null;
}
