import type { Prisma, ServiceConnection } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportedServiceConnection } from '@/lib/settings-export';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/arr-instances', () => ({
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
}));

import { applyServiceConnectionInTxn } from './services';

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
    expect(skipped).toEqual(['Skipped RADARR "Main": URL changed — enter the API key and any custom header values again to use a different URL']);
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
