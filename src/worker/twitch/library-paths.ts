import { constants } from 'node:fs';
import { lstat, open, rename, rm, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { LIBRARY_DIR } from './env';

/** Stored paths are the worker's own, but a delete is the last place to take that on trust. */
export function insideLibrary(relativePath: string, root = LIBRARY_DIR): string {
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error(`validation failed: ${relativePath} is outside the library`);
  }
  return resolved;
}

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code;

/**
 * Walks to a stored path's folder one step at a time, refusing links, and holds it open.
 * Other users of this group can write here, so a folder could turn into a link between
 * checking it and using it. A path through this handle always means the folder that was
 * checked, whatever happens to its name afterwards.
 */
async function pinFolder(relative: string): Promise<FileHandle> {
  const steps = path.relative(LIBRARY_DIR, path.dirname(insideLibrary(relative))).split(path.sep).filter(Boolean);
  let folder = await open(LIBRARY_DIR, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    for (const step of steps) {
      const next = await open(`/proc/self/fd/${folder.fd}/${step}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await folder.close();
      folder = next;
    }
    return folder;
  } catch (error) {
    await folder.close();
    if (codeOf(error) === 'ELOOP' || codeOf(error) === 'ENOTDIR') {
      throw new Error(`validation failed: ${relative} leads outside the library`);
    }
    throw error;
  }
}

const throughFolder = (folder: FileHandle, relative: string) => `/proc/self/fd/${folder.fd}/${path.basename(relative)}`;

/** Only a clear "not there" counts as false: a link on the way is refused, not reported missing. */
export async function existsInLibrary(relative: string): Promise<boolean> {
  let folder: FileHandle;
  try {
    folder = await pinFolder(relative);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return false;
    throw error;
  }
  try {
    await lstat(throughFolder(folder, relative));
    return true;
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return false;
    throw error;
  } finally {
    await folder.close();
  }
}

export async function removeInsideLibrary(relative: string): Promise<void> {
  let folder: FileHandle;
  try {
    folder = await pinFolder(relative);
  } catch (error) {
    // Its folder is already gone, so it is too. Anything else leaves the file in doubt.
    if (codeOf(error) === 'ENOENT') return;
    throw error;
  }
  try {
    await rm(throughFolder(folder, relative), { force: true });
  } finally {
    await folder.close();
  }
}

/** One rename, so the target is never missing. Only ever moves a regular file. */
export async function replaceInsideLibrary(from: string, to: string): Promise<void> {
  const source = await pinFolder(from);
  try {
    const target = await pinFolder(to);
    try {
      const moving = throughFolder(source, from);
      if (!(await lstat(moving)).isFile()) throw new Error('validation failed: the original is not a regular file');
      await rename(moving, throughFolder(target, to));
    } finally {
      await target.close();
    }
  } finally {
    await source.close();
  }
}
