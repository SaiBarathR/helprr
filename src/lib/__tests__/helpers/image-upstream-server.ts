import { createServer, type Server } from 'http';
import sharp from 'sharp';

export interface DeterministicImageUpstream {
  baseUrl: string;
  requests: URL[];
  close: () => Promise<void>;
}

async function imageFixtures(): Promise<Record<'jpeg' | 'png' | 'webp', Buffer>> {
  const source = sharp({
    create: {
      width: 32,
      height: 48,
      channels: 3,
      background: { r: 30, g: 60, b: 90 },
    },
  });
  const [jpeg, png, webp] = await Promise.all([
    source.clone().jpeg().toBuffer(),
    source.clone().png().toBuffer(),
    source.clone().webp().toBuffer(),
  ]);
  return { jpeg, png, webp };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

export async function createDeterministicImageUpstream(): Promise<DeterministicImageUpstream> {
  const fixtures = await imageFixtures();
  const requests: URL[] = [];
  const server = createServer((request, response) => {
    const origin = `http://${request.headers.host ?? '127.0.0.1'}`;
    const url = new URL(request.url ?? '/', origin);
    requests.push(url);
    const delay = Math.max(0, Number.parseInt(url.searchParams.get('delay') ?? '0', 10) || 0);

    const send = () => {
      const redirect = url.searchParams.get('redirect');
      if (redirect) {
        response.writeHead(302, { Location: redirect });
        response.end();
        return;
      }
      const status = Number.parseInt(url.searchParams.get('status') ?? '200', 10) || 200;
      if (status !== 200) {
        response.writeHead(status);
        response.end();
        return;
      }
      const declaredBytes = Number.parseInt(url.searchParams.get('bytes') ?? '0', 10) || 0;
      const formatParam = url.searchParams.get('format');
      const format = formatParam === 'png' || formatParam === 'webp' ? formatParam : 'jpeg';
      const body = declaredBytes > 0 ? Buffer.alloc(declaredBytes, 1) : fixtures[format];
      const defaultMime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
      response.writeHead(200, {
        'Content-Type': url.searchParams.get('mime') ?? defaultMime,
        'Content-Length': String(body.byteLength),
      });
      if (url.searchParams.get('abort') === 'true') {
        response.write(body.subarray(0, Math.max(1, Math.floor(body.byteLength / 2))));
        response.destroy();
        return;
      }
      response.end(body);
    };

    if (delay > 0) setTimeout(send, delay);
    else send();
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Image upstream did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}
