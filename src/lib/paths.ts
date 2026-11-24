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
 * The path a title moves to in another root folder and/or under another folder
 * name, or null when both are the ones it already has (a trailing separator
 * aside). An unchanged path must stay exactly as it was: the API treats any
 * other string as a path change.
 */
export function pathInRootFolder(path: string, rootFolder: string, folder = lastPathSegment(path)): string | null {
  if (!rootFolder) return null;
  const sameRoot = withoutTrailingSeparators(rootFolder, separatorOf(rootFolder)) === withoutTrailingSeparators(parentPath(path), separatorOf(path));
  if (sameRoot && folder === lastPathSegment(path)) return null;
  return folder ? joinPath(rootFolder, folder) : null;
}

/** Longest folder name most filesystems take (255 bytes in UTF-8). */
const FOLDER_NAME_MAX_BYTES = 255;

/**
 * Why `name` can't be a title's folder directly inside a root folder, or null
 * when it can. The Edit pages show it, and the PUT routes refuse the same names,
 * so a typed name can neither climb out of the root folder (`..`, separators)
 * nor make a folder that is awkward to see or remove.
 */
export function folderNameError(name: string): string | null {
  if (!name) return 'Enter a folder name';
  if (/[/\\]/.test(name)) return 'A folder name can’t contain / or \\';
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'A folder name can’t contain control characters';
  // Also refuses "." and "..": they start with a dot.
  if (/^[\s.]|[\s.]$/.test(name)) return 'A folder name can’t start or end with a space or a dot';
  if (new TextEncoder().encode(name).length > FOLDER_NAME_MAX_BYTES) return 'This folder name is too long';
  return null;
}
