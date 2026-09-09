import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const sw = await readFile('public/sw.js', 'utf8');
const manifest = sw.slice(sw.lastIndexOf('precacheEntries:[')).split('],')[0];
const entries = [...manifest.matchAll(/["']url["']:["']([^"']+)["']/g)].map((match) => match[1]);
if (!entries.length) throw new Error('No precache entries found; inspect the generated worker format');
let raw = 0, gzip = 0;
for (const url of entries) {
  if (/\.bak|\/libass\//.test(url)) throw new Error(`Optional asset precached: ${url}`);
  const path = url.startsWith('/_next/') ? `.next/${url.slice(7)}` : `public${url}`;
  const bytes = await readFile(path);
  raw += (await stat(path)).size;
  gzip += gzipSync(bytes).length;
  if (url.endsWith('.js') && /hls\.js|recharts-scale|recharts\/|Hls\.Events/.test(bytes.toString())) throw new Error(`Optional player/chart chunk precached: ${url}`);
}
const build = JSON.parse(await readFile('.next/build-manifest.json', 'utf8'));
for (const file of build.rootMainFiles) if (!entries.includes(`/_next/${file}`)) throw new Error(`Missing shell dependency: ${file}`);
if (!entries.includes('/offline.html')) throw new Error('Offline fallback missing');
if (entries.length > 80 || raw > 2_500_000) throw new Error(`Precache budget exceeded: ${entries.length} entries, ${raw} bytes`);
console.log(JSON.stringify({ entries: entries.length, rawBytes: raw, independentGzipBytes: gzip, urls: entries }, null, 2));
