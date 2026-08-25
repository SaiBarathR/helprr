import { createServer } from 'http';
import sharp from 'sharp';

const port = Number.parseInt(process.env.HELPRR_IMAGE_UPSTREAM_PORT ?? '39091', 10);
const defaultDelayMs = Math.max(
  0,
  Number.parseInt(process.env.HELPRR_IMAGE_UPSTREAM_DELAY_MS ?? '0', 10) || 0,
);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error('HELPRR_IMAGE_UPSTREAM_PORT must be a valid TCP port.');
}

const posterWidth = 720;
const posterHeight = 1_080;
const posterPixels = Buffer.alloc(posterWidth * posterHeight * 3);
for (let y = 0; y < posterHeight; y += 1) {
  for (let x = 0; x < posterWidth; x += 1) {
    const offset = (y * posterWidth + x) * 3;
    const grain = (x * 17 + y * 29 + (x * y) % 67) % 72;
    posterPixels[offset] = (32 + Math.floor(x * 150 / posterWidth) + grain) % 256;
    posterPixels[offset + 1] = (48 + Math.floor(y * 125 / posterHeight) + grain) % 256;
    posterPixels[offset + 2] = (92 + Math.floor((x + y) * 90 / (posterWidth + posterHeight)) + grain) % 256;
  }
}
const poster = await sharp(posterPixels, {
  raw: { width: posterWidth, height: posterHeight, channels: 3 },
}).jpeg({ quality: 88 }).toBuffer();

let requests = 0;
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname === '/metrics') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ requests }));
    return;
  }
  if (!/^\/poster\/[0-9]+\.jpg$/.test(url.pathname)) {
    response.writeHead(404);
    response.end();
    return;
  }
  requests += 1;
  const delayMs = Math.max(
    0,
    Number.parseInt(url.searchParams.get('delay') ?? String(defaultDelayMs), 10) || 0,
  );
  const send = () => {
    response.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(poster.byteLength),
      'Cache-Control': 'no-store',
    });
    response.end(poster);
  };
  if (delayMs > 0) setTimeout(send, delayMs);
  else send();
});

server.listen(port, '0.0.0.0', () => {
  console.log(`image-harness-upstream-ready:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
