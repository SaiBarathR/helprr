import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Every transport is exercised against a local server or a mocked SMTP layer:
// nothing here reaches a real notification service.

const smtp = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn(), close: vi.fn() }));
vi.mock('nodemailer', () => ({ createTransport: smtp.createTransport }));

const dns = vi.hoisted(() => ({ answers: {} as Record<string, { address: string; family: number }[]> }));
vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>();
  return {
    ...actual,
    lookup: (hostname: string, options: unknown, cb: (e: Error | null, a: unknown) => void) => {
      const answer = dns.answers[hostname];
      if (answer) return cb(null, answer);
      return actual.lookup(hostname, options as never, cb as never);
    },
  };
});

import { ChannelSendError, sendToChannel as send, type ChannelMessage } from './transports';
import type { FieldMap } from './config';

const ADMIN = { allowPrivate: true };
const MEMBER = { allowPrivate: false };
const sendToChannel = (type: Parameters<typeof send>[0], config: FieldMap, secrets: FieldMap, msg: ChannelMessage, rules = ADMIN) =>
  send(type, config, secrets, msg, rules);

interface Received { method?: string; url?: string; headers: IncomingHttpHeaders; body: unknown }

let server: Server;
let origin: string;
let received: Received[] = [];
let respond: (url: string, res: import('node:http').ServerResponse) => void = (_url, res) => {
  res.statusCode = 200;
  res.end('ok');
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      respond(req.url ?? '', res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  dns.answers = {};
  respond = (_url, res) => {
    res.statusCode = 200;
    res.end('ok');
  };
  vi.restoreAllMocks();
  smtp.createTransport.mockReset().mockReturnValue({ sendMail: smtp.sendMail, close: smtp.close });
  smtp.sendMail.mockReset().mockResolvedValue({ messageId: 'x' });
});

const message: ChannelMessage = {
  eventType: 'imported',
  title: 'Imported: Dune',
  body: 'Dune (2021) was imported',
  link: 'https://helprr.example/movies/1',
  path: '/movies/1',
  metadata: { source: 'radarr', movieId: 1 },
  sentAt: '2026-11-07T10:00:00.000Z',
};

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ChannelSendError);
    return (error as ChannelSendError).reason;
  }
  throw new Error('expected the send to fail');
}

describe('ntfy', () => {
  it('posts a JSON message to the server root with the topic, link and token', async () => {
    await sendToChannel('ntfy', { serverUrl: `${origin}/`, priority: '4' }, { topic: 'helprr-abc', token: 'tk_secret' }, message);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/' });
    expect(received[0].headers.authorization).toBe('Bearer tk_secret');
    expect(received[0].body).toEqual({
      topic: 'helprr-abc',
      title: 'Imported: Dune',
      message: 'Dune (2021) was imported',
      priority: 4,
      click: 'https://helprr.example/movies/1',
    });
  });

  it('uses basic auth when a user name and password are set', async () => {
    await sendToChannel('ntfy', { serverUrl: origin, username: 'me' }, { topic: 't', password: 'pw' }, { ...message, link: null });
    expect(received[0].headers.authorization).toBe(`Basic ${Buffer.from('me:pw').toString('base64')}`);
    expect(received[0].body).not.toHaveProperty('click');
  });
});

describe('Gotify', () => {
  it('posts to /message with the app token header and a click link', async () => {
    await sendToChannel('gotify', { serverUrl: `${origin}/gotify`, priority: '8' }, { appToken: 'AppTok' }, message);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/gotify/message' });
    expect(received[0].headers['x-gotify-key']).toBe('AppTok');
    expect(received[0].body).toEqual({
      title: 'Imported: Dune',
      message: 'Dune (2021) was imported',
      priority: 8,
      extras: { 'client::notification': { click: { url: 'https://helprr.example/movies/1' } } },
    });
  });
});

describe('webhook', () => {
  it('posts the event as JSON with the shared-secret header', async () => {
    await sendToChannel(
      'webhook',
      { headerName: 'X-Helprr-Secret' },
      { url: `${origin}/api/webhook/ha-id`, headerValue: 'shh' },
      message,
    );
    expect(received[0]).toMatchObject({ method: 'POST', url: '/api/webhook/ha-id' });
    expect(received[0].headers['x-helprr-secret']).toBe('shh');
    expect(received[0].headers['content-type']).toContain('application/json');
    expect(received[0].body).toEqual({
      source: 'helprr',
      event: 'imported',
      title: 'Imported: Dune',
      body: 'Dune (2021) was imported',
      url: 'https://helprr.example/movies/1',
      path: '/movies/1',
      metadata: { source: 'radarr', movieId: 1 },
      sentAt: '2026-11-07T10:00:00.000Z',
    });
  });

  it('reports a non-2xx answer by its status only', async () => {
    respond = (_url, res) => {
      res.statusCode = 401;
      res.end('token=leaky-detail');
    };
    expect(await reasonOf(sendToChannel('webhook', {}, { url: `${origin}/hook` }, message))).toBe('HTTP 401');
  });

  it('does not follow a redirect to another host', async () => {
    respond = (url, res) => {
      res.statusCode = 307;
      res.setHeader('Location', 'http://localhost:1/steal');
      res.end();
    };
    expect(await reasonOf(sendToChannel('webhook', {}, { url: `${origin}/hook` }, message))).toBe('Redirects to another address');
    expect(received).toHaveLength(1);
  });

  it('refuses a stored address that points at cloud metadata, without connecting', async () => {
    expect(await reasonOf(sendToChannel('webhook', {}, { url: 'http://169.254.169.254/latest' }, message))).toBe('Address not allowed');
  });

  it('refuses a name that resolves to a metadata address at connect time', async () => {
    dns.answers['rebind.example'] = [{ address: '169.254.169.254', family: 4 }];
    expect(await reasonOf(sendToChannel('webhook', {}, { url: 'http://rebind.example/hook' }, message))).toBe('Address not allowed');
  });

  it('keeps a member\'s channel off the local network, as typed and after resolving', async () => {
    expect(await reasonOf(sendToChannel('webhook', {}, { url: `${origin}/hook` }, message, MEMBER))).toBe('Address not allowed');
    dns.answers['public-looking.example'] = [{ address: '127.0.0.1', family: 4 }];
    expect(await reasonOf(sendToChannel('webhook', {}, { url: 'http://public-looking.example/hook' }, message, MEMBER))).toBe('Address not allowed');
    expect(received).toHaveLength(0);
  });

  it('gives up at the deadline instead of waiting on a server that never answers', async () => {
    respond = () => { /* never answers */ };
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('deadline', 'TimeoutError')), 50);
      return controller.signal;
    });
    expect(await reasonOf(sendToChannel('webhook', {}, { url: `${origin}/slow` }, message))).toBe('Timed out');
  });
});

describe('Apprise', () => {
  it('posts to /notify/{key} with the tags and the link in the body', async () => {
    await sendToChannel('apprise', { apiUrl: origin, tags: 'phone, tv' }, { key: 'family' }, message);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/notify/family' });
    expect(received[0].body).toEqual({
      title: 'Imported: Dune',
      body: 'Dune (2021) was imported\n\nhttps://helprr.example/movies/1',
      type: 'info',
      tag: 'phone,tv',
    });
  });

  it('still sends a channel saved with the key in its config (edge builds before 1.15.0)', async () => {
    await sendToChannel('apprise', { apiUrl: origin, key: 'old' }, {}, message);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/notify/old' });
  });
});

describe('email', () => {
  it('connects to the guarded address with STARTTLS required and the host as TLS name', async () => {
    dns.answers['smtp.example.com'] = [{ address: '203.0.113.7', family: 4 }];
    await sendToChannel(
      'email',
      { host: 'smtp.example.com', port: '587', security: 'starttls', username: 'me', from: 'h@example.com', to: 'me@example.com' },
      { password: 'app-pass' },
      message,
    );
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: '203.0.113.7',
      port: 587,
      secure: false,
      requireTLS: true,
      servername: 'smtp.example.com',
      auth: { user: 'me', pass: 'app-pass' },
      connectionTimeout: 10_000,
    }));
    expect(smtp.sendMail).toHaveBeenCalledWith({
      from: 'h@example.com',
      to: 'me@example.com',
      subject: 'Imported: Dune',
      text: 'Dune (2021) was imported\n\nhttps://helprr.example/movies/1',
    });
    expect(smtp.close).toHaveBeenCalled();
  });

  it('uses implicit TLS for the tls setting', async () => {
    await sendToChannel('email', { host: '192.0.2.1', port: '465', security: 'tls', from: 'a@b.co', to: 'c@d.co' }, {}, message);
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: '192.0.2.1', secure: true, requireTLS: false, auth: undefined }));
  });

  it('refuses an SMTP host that resolves to a metadata address', async () => {
    dns.answers['smtp.evil'] = [{ address: '169.254.169.254', family: 4 }];
    const reason = await reasonOf(sendToChannel('email', { host: 'smtp.evil', port: '587', security: 'starttls', from: 'a@b.co', to: 'c@d.co' }, {}, message));
    expect(reason).toBe('Address not allowed');
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it('keeps a member\'s SMTP server off the local network', async () => {
    dns.answers['smtp.lan.example'] = [{ address: '192.168.1.3', family: 4 }];
    const reason = await reasonOf(sendToChannel('email', { host: 'smtp.lan.example', port: '587', security: 'starttls', from: 'a@b.co', to: 'c@d.co' }, {}, message, MEMBER));
    expect(reason).toBe('Address not allowed');
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it('reports SMTP failures by code, never by server text', async () => {
    smtp.sendMail.mockRejectedValue(Object.assign(new Error('535 bad password for me'), { code: 'EAUTH', responseCode: 535 }));
    const reason = await reasonOf(sendToChannel('email', { host: '192.0.2.1', port: '587', security: 'starttls', from: 'a@b.co', to: 'c@d.co' }, {}, message));
    expect(reason).toBe('SMTP 535');
  });
});
