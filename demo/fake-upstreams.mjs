// Helprr's demo upstreams: answers the Sonarr, Radarr, Lidarr, qBittorrent, Prowlarr,
// Jellyfin and Seerr endpoints Helprr calls, from a library invented at start-up
// (demo/library.mjs). Nothing in it comes from a real library. Read-only: any write gets
// a clear error.
//
//   node demo/fake-upstreams.mjs      one port per app (its usual one), images on 9000
//
// Dates are worked out from now: the library is rebuilt every few minutes, so the
// calendar, the queue and the activity stay current. It is invented from a fixed seed, so
// a rebuild changes only what time has changed (an episode that has now aired).
import http from 'node:http';
import sharp from 'sharp';
import { buildLibrary } from './library.mjs';
import { lidarr, radarr, sonarr } from './apps/servarr.mjs';
import { prowlarr, qbittorrent, seerr } from './apps/downloads.mjs';
import { createJellyfin } from './apps/jellyfin.mjs';
import { RAW } from './apps/raw.mjs';

// DEMO_PORT_OFFSET moves every port (tests run beside the real apps).
const OFFSET = Number(process.env.DEMO_PORT_OFFSET ?? 0);
if (!Number.isInteger(OFFSET) || OFFSET < 0 || OFFSET > 50_000) throw new Error('DEMO_PORT_OFFSET must be a whole number from 0 to 50000.');
const APPS = { sonarr: 8989, radarr: 7878, lidarr: 8686, qbittorrent: 8080, prowlarr: 9696, jellyfin: 8096, seerr: 5055 };
const IMAGE_PORT = 9000;
const REBUILD_MS = 5 * 60_000;
const MAX_BODY = 64 * 1024;

let current = null;
function state() {
  if (!current || Date.now() - current.lib.now > REBUILD_MS) {
    const lib = buildLibrary(Date.now());
    current = { lib, sonarr, radarr, lidarr, qbittorrent, prowlarr, seerr, jellyfin: createJellyfin(lib) };
  }
  return current;
}

function answer(app, method, path, query, body) {
  const s = state();
  return app === 'jellyfin' ? s.jellyfin(method, path, query, body) : s[app](s.lib, method, path, query);
}

// Helprr's image proxy takes raster images only, and the image has no fonts: a poster is
// a gradient in the title's colour with a film-frame mark. Only the colour varies, so at
// most 360 are ever rendered, each once even when asked for together.
const posters = new Map();
function poster(title) {
  let hash = 0;
  for (const char of String(title || 'Demo')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  if (!posters.has(hue)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},48%,38%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},52%,13%)"/></linearGradient></defs>
<rect width="300" height="450" fill="url(#g)"/>
<rect x="105" y="170" width="90" height="70" rx="6" fill="none" stroke="#f5efe6" stroke-opacity="0.5" stroke-width="5"/>
<circle cx="150" cy="205" r="14" fill="#f5efe6" fill-opacity="0.5"/>
<rect x="0" y="0" width="300" height="450" fill="none" stroke="#000" stroke-opacity="0.25" stroke-width="10"/></svg>`;
    const rendering = sharp(Buffer.from(svg)).png().toBuffer();
    rendering.catch(() => posters.delete(hue));
    posters.set(hue, rendering);
  }
  return posters.get(hue);
}

function sendPoster(res, title) {
  poster(title).then(
    (png) => send(res, 200, 'image/png', png),
    () => send(res, 500, 'text/plain', 'poster failed'),
  );
}

function isImage(path) {
  return /\/Images\/|\/mediacover\/|\/MediaCover\/|\.(jpe?g|png|webp|gif)$/i.test(path);
}

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const READ_ONLY = JSON.stringify({ message: 'This is the Helprr demo: it is read-only, so nothing was changed.' });

// A handler answers a value (sent as JSON), raw() for anything else, undefined when it
// has no such endpoint, or null for a write it refuses.
function reply(res, value, method) {
  if (value === undefined) return send(res, method === 'GET' ? 404 : 403, 'application/json', method === 'GET' ? '{}' : READ_ONLY);
  if (value === null) return send(res, 403, 'application/json', READ_ONLY);
  if (value?.[RAW]) return send(res, value.status, value.type, typeof value.body === 'string' ? value.body : JSON.stringify(value.body));
  return send(res, 200, 'application/json', JSON.stringify(value));
}

// A request line that is not a URL gets a 400; it must never stop the server.
function parse(req) {
  try {
    return new URL(req.url ?? '/', 'http://demo');
  } catch {
    return null;
  }
}

function readBody(req, done) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size <= MAX_BODY) chunks.push(chunk);
  });
  req.on('end', () => done(size > MAX_BODY ? '' : Buffer.concat(chunks).toString('utf8')));
}

for (const [app, port] of Object.entries(APPS)) {
  http
    .createServer((req, res) => {
      const url = parse(req);
      if (!url) {
        req.resume();
        return send(res, 400, 'text/plain', 'Bad request');
      }
      const path = url.pathname;
      // HEAD is answered as GET.
      const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');
      readBody(req, (body) => {
        // Seeded by the whole path, so each item has its own colour.
        if (method === 'GET' && isImage(path)) return sendPoster(res, `${app} ${path}`);
        // qBittorrent signs in before anything else; any login works.
        if (app === 'qbittorrent' && path === '/api/v2/auth/login') {
          res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'SID=demo; HttpOnly; path=/' });
          return res.end('Ok.');
        }
        try {
          reply(res, answer(app, method, path, url.searchParams, body), method);
        } catch (error) {
          console.error(`demo ${app} ${method} ${path}:`, error);
          send(res, 500, 'application/json', '{"message":"The demo could not answer that."}');
        }
      });
    })
    .listen(port + OFFSET, () => console.log(`demo ${app} on :${port + OFFSET}`));
}

http
  .createServer((req, res) => {
    req.resume();
    sendPoster(res, parse(req)?.searchParams.get('title') ?? 'Demo');
  })
  .listen(IMAGE_PORT + OFFSET, () => console.log(`demo images on :${IMAGE_PORT + OFFSET}`));
