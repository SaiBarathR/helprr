import path from 'node:path';

export const LIBRARY_DIR = process.env.TWITCH_LIBRARY_DIR || '/media/twitch';
export const TOOLS_DIR = process.env.TWITCH_TOOLS_DIR || '/data/tools';
export const FFMPEG = process.env.TWITCH_FFMPEG || '/usr/lib/jellyfin-ffmpeg/ffmpeg';
export const FFPROBE = process.env.TWITCH_FFPROBE || '/usr/lib/jellyfin-ffmpeg/ffprobe';
export const STAGING_DIR = path.join(LIBRARY_DIR, '.staging');
export const ORIGINALS_DIR = path.join(LIBRARY_DIR, '.originals');
export const WORKER_VERSION = process.env.APP_VERSION || 'development';
