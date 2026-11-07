import type { Prisma, ServiceConnection } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportedServiceConnection } from '@/lib/settings-export';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/arr-instances', () => ({
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
}));

import { applyServiceConnectionInTxn } from './services';
import { isServiceType } from '@/lib/service-connection-secrets';
import { encryptTwitchToken } from '@/lib/twitch/token-cipher';

const stored = {
  id: 'radarr-main', type: 'RADARR', label: 'Main', isDefault: true,
  url: 'https://radarr.example.invalid', apiKey: 'stored-key', username: null, externalUrl: null,
  accessToken: 'stored-access', refreshToken: 'stored-refresh', tokenExpiresAt: new Date('2030-01-01'),
  metadata: { userId: 'old-server-user' }, customHeaders: { Authorization: 'stored-proxy-secret' },
  createdAt: new Date(), updatedAt: new Date(),
} satisfies ServiceConnection;

const connection = (extra: Partial<ExportedServiceConnection> = {}): ExportedServiceConnection => ({
  type: 'RADARR', label: 'Main', isDefault: true, url: stored.url,
  apiKey: null, username: null, externalUrl: null, accessToken: null, refreshToken: null, customHeaders: null,
  ...extra,
});

let row: ServiceConnection;
const findFirst = vi.fn(async () => row);
const update = vi.fn(async ({ data }: { data: Partial<ServiceConnection> }) => Object.assign(row, data));
const create = vi.fn();
const tx = { serviceConnection: { findFirst, update, create } } as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.clearAllMocks();
  row = { ...stored };
});

describe('importing service connection secrets', () => {
  it.each([null, '', '   '])('skips a changed URL without a fresh key (%j), naming the instance that needs it', async (apiKey) => {
    const skipped: string[] = [];

    const applied = await applyServiceConnectionInTxn(tx, connection({ url: 'https://collector.example.invalid', apiKey }), skipped);

    expect(applied).toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(row).toEqual(stored);
    expect(skipped).toEqual(['Skipped RADARR "Main": URL changed. Enter the API key and any custom header values again to use a different URL.']);
  });

  it.each<ExportedServiceConnection['customHeaders']>([null, {}, { Host: 'collector.example.invalid' }])('drops old headers and token state when a fresh key changes the URL (headers: %j)', async (customHeaders) => {
    const skipped: string[] = [];

    expect(await applyServiceConnectionInTxn(tx, connection({
      url: 'https://replacement.example.invalid/', apiKey: 'fresh-key', customHeaders,
    }), skipped)).toBe('RADARR');

    expect(row).toEqual({
      ...stored,
      url: 'https://replacement.example.invalid', apiKey: 'fresh-key', customHeaders: {},
      accessToken: null, refreshToken: null, tokenExpiresAt: null,
    });
    expect(skipped).toEqual([]);
  });

  it('accepts explicitly supplied secrets for a replacement URL', async () => {
    await applyServiceConnectionInTxn(tx, connection({
      url: 'https://replacement.example.invalid', apiKey: 'fresh-key',
      accessToken: 'fresh-access', refreshToken: 'fresh-refresh', customHeaders: { Authorization: 'fresh-proxy-secret' },
    }), []);

    expect(row).toEqual({
      ...stored, url: 'https://replacement.example.invalid',
      apiKey: 'fresh-key', accessToken: 'fresh-access', refreshToken: 'fresh-refresh',
      customHeaders: { Authorization: 'fresh-proxy-secret' }, tokenExpiresAt: null,
    });
  });

  it.each<ExportedServiceConnection['customHeaders']>([null, {}, { Host: 'invalid.example.invalid' }])('preserves omitted secrets for the same normalized URL (headers: %j)', async (customHeaders) => {
    row.url = ` ${stored.url}/// `;
    const skipped: string[] = [];

    expect(await applyServiceConnectionInTxn(tx, connection({ url: ` ${stored.url}/ `, customHeaders }), skipped)).toBe('RADARR');

    expect(row).toEqual({ ...stored, url: stored.url });
    expect(skipped).toEqual([]);
  });
});

describe('importing the YouTube connection', () => {
  const youtube = (apiKey: string | null) => connection({ type: 'YOUTUBE', label: 'YouTube', url: 'https://www.googleapis.com/youtube/v3', apiKey });

  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'this-install');
    Object.assign(row, { type: 'YOUTUBE', url: 'https://www.googleapis.com/youtube/v3', apiKey: 'enc:v1:kept' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('restores a key this install encrypted', async () => {
    const apiKey = encryptTwitchToken('not-a-real-key');
    expect(await applyServiceConnectionInTxn(tx, youtube(apiKey), [])).toBe('YOUTUBE');
    expect(row.apiKey).toBe(apiKey);
  });

  it('keeps the stored key when the file has none', async () => {
    expect(await applyServiceConnectionInTxn(tx, youtube(null), [])).toBe('YOUTUBE');
    expect(row.apiKey).toBe('enc:v1:kept');
  });

  it('refuses a key from another install, leaving the working one alone', async () => {
    vi.stubEnv('JWT_SECRET', 'another-install');
    const foreign = encryptTwitchToken('not-a-real-key');
    vi.stubEnv('JWT_SECRET', 'this-install');
    const skipped: string[] = [];

    expect(await applyServiceConnectionInTxn(tx, youtube(foreign), skipped)).toBeNull();

    expect(update).not.toHaveBeenCalled();
    expect(skipped).toEqual(['Skipped YouTube: its key came from another Helprr. Enter it again in Settings.']);
  });
});

describe('the generic service routes', () => {
  it('still refuse YouTube, whose key must only be stored encrypted', () => {
    expect(isServiceType('YOUTUBE')).toBe(false);
  });
});

describe('a Jellyfin address change, for the sign-out of Jellyfin-linked accounts', () => {
  const jellyfin = { ...stored, id: 'jf', type: 'JELLYFIN', label: 'Jellyfin', url: 'http://jellyfin.lan:8096' } satisfies ServiceConnection;
  const entry = (url: string, apiKey: string | null = 'k') => connection({ type: 'JELLYFIN', label: 'Jellyfin', url, apiKey });

  it('is flagged for a new address, and for Jellyfin added where there was none', async () => {
    row = { ...jellyfin };
    const moved = { jellyfinAddress: false };
    await applyServiceConnectionInTxn(tx, entry('http://new.lan:8096'), [], moved);
    expect(moved.jellyfinAddress).toBe(true);

    findFirst.mockResolvedValueOnce(null as unknown as ServiceConnection);
    const added = { jellyfinAddress: false };
    await applyServiceConnectionInTxn(tx, entry('http://new.lan:8096'), [], added);
    expect(added.jellyfinAddress).toBe(true);
  });

  it('is not flagged for the same address, another service, or a skipped entry', async () => {
    row = { ...jellyfin };
    const changes = { jellyfinAddress: false };
    await applyServiceConnectionInTxn(tx, entry('http://jellyfin.lan:8096/', null), [], changes);
    row = { ...stored };
    await applyServiceConnectionInTxn(tx, connection({ url: 'https://other.example.invalid', apiKey: 'fresh' }), [], changes);
    row = { ...jellyfin };
    await applyServiceConnectionInTxn(tx, entry('http://new.lan:8096', null), [], changes);
    expect(changes.jellyfinAddress).toBe(false);
  });
});
