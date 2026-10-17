// Media paths come from the *arr instance's host OS, so they may be POSIX
// (/mnt/media/X) or Windows (C:\Media\X) style. Detect the separator from the
// path itself rather than assuming '/'.
function separatorOf(path: string): string {
  return path.includes('\\') ? '\\' : '/';
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
  return withoutTrailingSeparators(path, sep).split(sep).slice(0, -1).join(sep);
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
