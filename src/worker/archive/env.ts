import path from 'node:path';
import type { ArchivePlatform } from '@prisma/client';

const ROOTS: Record<ArchivePlatform, string> = {
  TWITCH: process.env.TWITCH_LIBRARY_DIR || '/media/twitch',
  YOUTUBE: process.env.YOUTUBE_LIBRARY_DIR || '/media/youtube',
};

export interface LibraryDirs {
  root: string;
  staging: string;
  originals: string;
}

/** The only way to a library path. Each file operation asks with the file's own platform. */
export function libraryFor(platform: ArchivePlatform): LibraryDirs {
  const root = ROOTS[platform];
  return { root, staging: path.join(root, '.staging'), originals: path.join(root, '.originals') };
}

export const TOOLS_DIR = process.env.TWITCH_TOOLS_DIR || '/data/tools';
export const FFMPEG = process.env.TWITCH_FFMPEG || '/usr/lib/jellyfin-ffmpeg/ffmpeg';
export const FFPROBE = process.env.TWITCH_FFPROBE || '/usr/lib/jellyfin-ffmpeg/ffprobe';
export const WORKER_VERSION = process.env.APP_VERSION || 'development';
