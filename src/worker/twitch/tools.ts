import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { TOOLS_DIR } from './env';
import { run } from './process';

// Tested on this project's host on 2026-10-29.
export const KNOWN_GOOD = { ytdlp: '2026.10.26', td: '1.56.5' } as const;
export type ToolName = keyof typeof KNOWN_GOOD;

const SMOKE_VIDEO_URL = process.env.TWITCH_SMOKE_VIDEO_URL;
const REPOS: Record<ToolName, string> = { ytdlp: 'yt-dlp/yt-dlp', td: 'lay295/TwitchDownloader' };

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string;
}

function assetName(tool: ToolName, version: string): string {
  const arm = process.arch === 'arm64';
  if (tool === 'ytdlp') return arm ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  return `TwitchDownloaderCLI-${version}-${arm ? 'LinuxArm64' : 'Linux-x64'}.zip`;
}

function versionDir(tool: ToolName, version: string): string {
  return path.join(TOOLS_DIR, tool, version);
}

function activeLink(tool: ToolName): string {
  return path.join(TOOLS_DIR, tool, 'active');
}

export function toolPath(tool: ToolName): string {
  return path.join(activeLink(tool), tool === 'ytdlp' ? 'yt-dlp' : 'TwitchDownloaderCLI');
}

async function fetchRelease(tool: ToolName, tag: string | 'latest') {
  const url = `https://api.github.com/repos/${REPOS[tool]}/releases/${tag === 'latest' ? 'latest' : `tags/${tag}`}`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub release lookup for ${tool} failed (${res.status})`);
  return (await res.json()) as { tag_name: string; assets: ReleaseAsset[] };
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function download(url: string, file: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  await pipeline(Readable.fromWeb(res.body as ReadableStream), createWriteStream(file));
}

async function expectedHash(tool: ToolName, name: string, assets: ReleaseAsset[]): Promise<string> {
  if (tool === 'ytdlp') {
    const sums = assets.find((asset) => asset.name === 'SHA2-256SUMS');
    if (!sums) throw new Error('yt-dlp release has no SHA2-256SUMS');
    const res = await fetch(sums.browser_download_url);
    const line = (await res.text()).split('\n').find((entry) => entry.trim().endsWith(` ${name}`) || entry.trim().endsWith(`*${name}`));
    const hash = line?.split(/\s+/)[0];
    if (!hash) throw new Error(`SHA2-256SUMS does not list ${name}`);
    return hash;
  }
  const digest = assets.find((asset) => asset.name === name)?.digest;
  if (!digest?.startsWith('sha256:')) throw new Error(`GitHub reports no digest for ${name}`);
  return digest.slice('sha256:'.length);
}

async function smokeTest(tool: ToolName, binary: string): Promise<void> {
  // TwitchDownloaderCLI prints its version and then exits 1, so the output is what counts.
  const output = await run(binary, ['--version'], { env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } })
    .catch((error: Error) => error.message);
  if (!/\d+\.\d+/.test(output)) throw new Error(`${tool} did not report a version`);
  if (tool === 'ytdlp' && SMOKE_VIDEO_URL) await run(binary, ['-J', '--no-playlist', SMOKE_VIDEO_URL]);
}

/** Verified, smoke-tested, and only then made active. A failure leaves the old version in place. */
export async function installTool(tool: ToolName, version: string): Promise<void> {
  const release = await fetchRelease(tool, version);
  const name = assetName(tool, version);
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (!asset) throw new Error(`Release ${version} of ${tool} has no ${name}`);
  const expected = await expectedHash(tool, name, release.assets);

  const scratch = await mkdtemp(path.join(os.tmpdir(), `${tool}-`));
  try {
    const fetched = path.join(scratch, name);
    await download(asset.browser_download_url, fetched);
    if ((await sha256(fetched)) !== expected) throw new Error(`Checksum mismatch for ${name}`);

    const target = versionDir(tool, version);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    const binary = path.join(target, tool === 'ytdlp' ? 'yt-dlp' : 'TwitchDownloaderCLI');
    if (tool === 'ytdlp') {
      await rename(fetched, binary).catch(async () => {
        await writeFile(binary, await readFile(fetched));
      });
    } else {
      await run('unzip', ['-o', '-j', fetched, 'TwitchDownloaderCLI', '-d', target]);
    }
    await chmod(binary, 0o755);
    await smokeTest(tool, binary);

    const link = activeLink(tool);
    const next = `${link}.next`;
    await rm(next, { force: true });
    await symlink(version, next);
    await rename(next, link);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function activeVersion(tool: ToolName): Promise<string | null> {
  try {
    const { readlink } = await import('node:fs/promises');
    return await readlink(activeLink(tool));
  } catch {
    return null;
  }
}

export async function latestVersion(tool: ToolName): Promise<string> {
  return (await fetchRelease(tool, 'latest')).tag_name;
}

/** First start, or a pin that changed. */
/** Whether any tool moved. Pins are the owner's word, so a pinned tool stays put. */
export async function updateTools(pins: Partial<Record<ToolName, string>>): Promise<boolean> {
  let updated = false;
  for (const tool of Object.keys(KNOWN_GOOD) as ToolName[]) {
    if (pins[tool]) continue;
    const version = await latestVersion(tool);
    if (version === (await activeVersion(tool))) continue;
    await installTool(tool, version);
    updated = true;
  }
  return updated;
}

export async function ensureTools(pins: Partial<Record<ToolName, string>>): Promise<void> {
  for (const tool of Object.keys(KNOWN_GOOD) as ToolName[]) {
    const wanted = pins[tool] ?? KNOWN_GOOD[tool];
    if ((await activeVersion(tool)) !== wanted) await installTool(tool, wanted);
  }
}
