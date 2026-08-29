#!/usr/bin/env node
/**
 * Copy the libass-wasm worker assets into public/libass/.
 *
 * ASS/SSA subtitles are rendered by @jellyfin/libass-wasm, whose worker, wasm
 * module, and fallback font must be served from our own origin (the CSP allows
 * `worker-src 'self' blob:` and nothing external). They are build artifacts of a
 * pinned dependency, not source, so they are generated here instead of being
 * committed — 7.3 MB of minified vendor bundles do not belong in git history.
 *
 * Runs from `prebuild` and `predev`. Idempotent: unchanged files are skipped.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@jellyfin', 'libass-wasm', 'dist', 'js');
const dest = join(root, 'public', 'libass');

// COPYRIGHT ships the libass/fontconfig/freetype licences; copy it alongside.
const FILES = [
  'subtitles-octopus-worker.js',
  'subtitles-octopus-worker-legacy.js',
  'subtitles-octopus-worker.wasm',
  'default.woff2',
  'COPYRIGHT',
];

if (!existsSync(src)) {
  console.error(`copy-libass-assets: ${src} is missing — run npm ci first.`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

let copied = 0;
for (const file of FILES) {
  const from = join(src, file);
  const to = join(dest, file);
  if (!existsSync(from)) {
    console.error(`copy-libass-assets: expected ${file} in @jellyfin/libass-wasm`);
    process.exit(1);
  }
  const sameSize = existsSync(to) && statSync(to).size === statSync(from).size;
  if (sameSize && readFileSync(to).equals(readFileSync(from))) continue;
  copyFileSync(from, to);
  copied += 1;
}

console.log(`copy-libass-assets: OK (${FILES.length} assets, ${copied} updated)`);
