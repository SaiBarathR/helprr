import { beforeEach, describe, expect, it, vi } from 'vitest';

const dns = vi.hoisted(() => ({ answers: {} as Record<string, { address: string; family: number }[]> }));

// This server's own interfaces: loopback, a LAN address, and a VPS-style public one.
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  networkInterfaces: () => ({
    lo: [{ address: '127.0.0.1', family: 'IPv4' }, { address: '::1', family: 'IPv6' }],
    eth0: [{ address: '203.0.113.7', family: 'IPv4' }, { address: '2001:db8::7', family: 'IPv6' }],
  }),
}));

vi.mock('node:dns', () => ({
  lookup: (hostname: string, _options: unknown, cb: (e: Error | null, a: unknown) => void) => {
    const answer = dns.answers[hostname];
    if (!answer) cb(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }), []);
    else cb(null, answer);
  },
}));

import {
  checkOutboundUrl,
  createGuardedLookup,
  guardedLookup,
  isBlockedAddress,
  OutboundAddressError,
  resolveOutboundHost,
} from '@/lib/outbound-url';

beforeEach(() => {
  dns.answers = {};
});

describe('checkOutboundUrl', () => {
  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://2852039166/', // 169.254.169.254 written as one number
    'http://0xa9.0xfe.0xa9.0xfe/',
    'http://[::ffff:169.254.169.254]/',
    'http://[fd00:ec2::254]/',
    'http://[fe80::1]/',
    'http://169.254.170.2/v2/credentials',
    'http://100.100.100.200/latest/meta-data',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://METADATA.GOOGLE.INTERNAL./',
    'http://0.0.0.0:8080/',
    'http://224.0.0.1/',
    'http://[64:ff9b::a9fe:a9fe]/', // NAT64
    'http://[64:ff9b:1::a9fe:a9fe]/',
    'http://[2002:a9fe:a9fe::]/', // 6to4
    'http://[::a9fe:a9fe]/', // IPv4-compatible
    'http://168.63.129.16/', // Azure WireServer
    'http://192.0.0.192/', // OCI
  ])('refuses the metadata or reserved address %s', (url) => {
    const result = checkOutboundUrl(url);
    expect(result.ok).toBe(false);
  });

  it.each([
    'https://ntfy.sh',
    'http://192.168.1.20:8123/api/webhook/abc',
    'http://10.0.0.5:2586',
    'http://127.0.0.1:8000',
    'http://homeassistant.local:8123',
    'http://[fd12:3456::1]:80/',
    'http://100.101.102.103:8080', // a Tailscale address
  ])('accepts the LAN or public address %s, like a service connection', (url) => {
    expect(checkOutboundUrl(url)).toMatchObject({ ok: true });
  });

  it.each([
    'http://192.168.1.20:8123/api/webhook/abc',
    'http://10.0.0.5:2586',
    'http://127.0.0.1:2375/containers/x/stop',
    'http://localhost:8000',
    'http://homeassistant.local:8123',
    'http://ntfy/',
    'http://100.101.102.103:8080',
    'http://[fd12:3456::1]/',
    'http://[::1]/',
    'http://[::ffff:192.168.1.1]/',
    'http://[64:ff9b::c0a8:0101]/', // 192.168.1.1 through NAT64
  ])('keeps a member off the local network: %s', (url) => {
    expect(checkOutboundUrl(url, { allowPrivate: false })).toMatchObject({ ok: false });
  });

  it('lets a member send to public addresses', () => {
    expect(checkOutboundUrl('https://ntfy.sh', { allowPrivate: false })).toMatchObject({ ok: true });
    expect(checkOutboundUrl('https://8.8.8.8/x', { allowPrivate: false })).toMatchObject({ ok: true });
    expect(checkOutboundUrl('https://[2606:4700::1111]/', { allowPrivate: false })).toMatchObject({ ok: true });
  });

  it('refuses other schemes, a missing scheme and credentials in the URL', () => {
    expect(checkOutboundUrl('ftp://example.com/')).toMatchObject({ ok: false });
    expect(checkOutboundUrl('file:///etc/passwd')).toMatchObject({ ok: false });
    expect(checkOutboundUrl('ntfy.sh/topic')).toMatchObject({ ok: false });
    expect(checkOutboundUrl('https://user:pass@ntfy.sh/')).toMatchObject({ ok: false });
    expect(checkOutboundUrl('')).toMatchObject({ ok: false });
  });
});

describe('isBlockedAddress', () => {
  it("keeps a member off this server's own addresses, its public one included", () => {
    const member = { allowPrivate: false };
    expect(isBlockedAddress('203.0.113.7', member)).toBe(true);
    expect(isBlockedAddress('2001:db8::7', member)).toBe(true);
    expect(isBlockedAddress('::ffff:203.0.113.7', member)).toBe(true);
    expect(isBlockedAddress('203.0.113.8', member)).toBe(false);
    // An admin may reach anything on the server's own network.
    expect(isBlockedAddress('203.0.113.7')).toBe(false);
  });

  it('blocks link-local in both families and v4-mapped v6', () => {
    expect(isBlockedAddress('169.254.10.10')).toBe(true);
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedAddress('fe80::abcd')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(false);
    expect(isBlockedAddress('not an ip')).toBe(true);
  });
});

describe('guardedLookup', () => {
  function lookup(hostname: string, all = false): Promise<{ error: Error | null; address: unknown }> {
    return new Promise((resolve) => {
      guardedLookup(hostname, { all }, (error, address) => resolve({ error, address }));
    });
  }

  it('refuses a name that resolves to a metadata address', async () => {
    dns.answers['evil.example'] = [{ address: '169.254.169.254', family: 4 }];
    const { error } = await lookup('evil.example');
    expect(error).toBeInstanceOf(OutboundAddressError);
  });

  it('refuses a name when any one of its addresses is blocked', async () => {
    dns.answers['mixed.example'] = [{ address: '93.184.216.34', family: 4 }, { address: 'fe80::1', family: 6 }];
    const { error } = await lookup('mixed.example', true);
    expect(error).toBeInstanceOf(OutboundAddressError);
  });

  it('passes an allowed name through in the form asked for', async () => {
    dns.answers['ntfy.local'] = [{ address: '192.168.1.9', family: 4 }];
    expect(await lookup('ntfy.local')).toEqual({ error: null, address: '192.168.1.9' });
    expect(await lookup('ntfy.local', true)).toEqual({ error: null, address: [{ address: '192.168.1.9', family: 4 }] });
  });

  it('refuses a public-looking name that resolves to a LAN address, for a member only', async () => {
    dns.answers['sneaky.example'] = [{ address: '192.168.1.5', family: 4 }];
    const member = await new Promise<Error | null>((resolve) => {
      createGuardedLookup({ allowPrivate: false })('sneaky.example', {}, (error) => resolve(error));
    });
    expect(member).toBeInstanceOf(OutboundAddressError);
    expect((await lookup('sneaky.example')).error).toBeNull();
    await expect(resolveOutboundHost('sneaky.example', { allowPrivate: false })).rejects.toBeInstanceOf(OutboundAddressError);
  });

  it('refuses a metadata hostname without resolving it', async () => {
    const { error } = await lookup('metadata.google.internal');
    expect(error).toBeInstanceOf(OutboundAddressError);
  });

  it('resolveOutboundHost applies the same rule to SMTP hosts', async () => {
    dns.answers['smtp.example'] = [{ address: '203.0.113.5', family: 4 }];
    dns.answers['smtp.evil'] = [{ address: '169.254.169.254', family: 4 }];
    await expect(resolveOutboundHost('smtp.example')).resolves.toBe('203.0.113.5');
    await expect(resolveOutboundHost('smtp.evil')).rejects.toBeInstanceOf(OutboundAddressError);
    await expect(resolveOutboundHost('169.254.169.254')).rejects.toBeInstanceOf(OutboundAddressError);
    await expect(resolveOutboundHost('192.168.1.2')).resolves.toBe('192.168.1.2');
  });
});
