// Every link inside the built site points at a page or file that exists, and every
// #section at a heading on that page. Run after `astro build` (npm run build); links to
// other sites are left to the browser.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
// Keep in step with site and base in astro.config.mjs.
const SITE = 'https://saibarathr.github.io';
const BASE = '/helprr/';

function* pages(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* pages(path);
    else if (name.endsWith('.html')) yield path;
  }
}

// The file a site path is served from, or null.
function file(pathname) {
  const path = join(DIST, decodeURIComponent(pathname.slice(BASE.length)));
  if (existsSync(path) && statSync(path).isFile()) return path;
  if (existsSync(join(path, 'index.html'))) return join(path, 'index.html');
  return null;
}

const ids = new Map();
function idsOf(path) {
  if (!ids.has(path)) ids.set(path, new Set([...readFileSync(path, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return ids.get(path);
}

const broken = [];
let checked = 0;
for (const page of pages(DIST)) {
  const name = page.slice(DIST.length);
  // A page's canonical address is metadata, not a link to follow (the 404 page names /404/).
  const html = readFileSync(page, 'utf8').replace(/<link[^>]*rel="canonical"[^>]*>/g, '');
  // The page's own address, so a relative link resolves as a browser would. Pages serves
  // the 404 page at whatever address was missing, so its links must not be relative.
  const at = new URL(BASE + name.replace(/index\.html$/, ''), SITE);
  const links = [
    ...[...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((part) => part.trim().split(/\s+/)[0])),
  ];
  for (const raw of links) {
    const href = raw.replaceAll('&amp;', '&');
    if (/^(mailto|tel|data|javascript):/i.test(href)) continue;
    const url = new URL(href, at);
    if (url.origin !== SITE) continue;
    checked++;
    const relative = !/^([a-z]+:)?\//i.test(href) && !href.startsWith('#');
    if (name === '404.html' && relative) {
      broken.push(`${name} -> ${href} (relative, on the 404 page)`);
      continue;
    }
    const target = url.pathname.startsWith(BASE) ? file(url.pathname) : null;
    if (!target) broken.push(`${name} -> ${href}`);
    else if (url.hash && url.hash !== '#' && target.endsWith('.html') && !idsOf(target).has(decodeURIComponent(url.hash.slice(1)))) {
      broken.push(`${name} -> ${href} (no such section)`);
    }
  }
}
if (broken.length) {
  console.error(`Broken links (${broken.length}):\n${broken.join('\n')}`);
  process.exit(1);
}
console.log(`Links checked: ${checked}, all found.`);
