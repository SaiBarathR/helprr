import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The operation audit names the qBittorrent a row is for when there are several.
const mocks = vi.hoisted(() => ({ records: [] as unknown[], qbits: [] as Array<{ id: string; label: string }> }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ ok: true, user: { id: 'admin-1', role: 'admin' } })) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({
  prisma: { fileOperationAudit: { findMany: vi.fn(async () => mocks.records), count: vi.fn(async () => mocks.records.length) } },
}));
vi.mock('@/lib/arr-instances', () => ({ listConnections: vi.fn(async () => mocks.qbits) }));

import { GET } from '@/app/api/file-audit/route';

const row = (id: string, service: string, instanceId: string | null) => ({ id, service, instanceId, operation: 'DELETE_TORRENT' });
const labels = async () => {
  const res = await GET(new NextRequest('http://localhost/api/file-audit'));
  const body = await res.json() as { records: Array<{ id: string; instanceLabel: string | null }> };
  return Object.fromEntries(body.records.map((record) => [record.id, record.instanceLabel]));
};

beforeEach(() => {
  mocks.records = [row('main', 'QBITTORRENT', 'q1'), row('seed', 'QBITTORRENT', 'q2'), row('gone', 'QBITTORRENT', 'q9'), row('old', 'QBITTORRENT', null), row('arr', 'RADARR', 'q1')];
});

describe('GET /api/file-audit instance names', () => {
  it('names each qBittorrent row when there are several, not a removed one or another service', async () => {
    mocks.qbits = [{ id: 'q1', label: 'Home' }, { id: 'q2', label: 'Seedbox' }];
    expect(await labels()).toEqual({ main: 'Home', seed: 'Seedbox', gone: null, old: null, arr: null });
  });

  it('names none with one qBittorrent', async () => {
    mocks.qbits = [{ id: 'q1', label: 'Home' }];
    expect(await labels()).toEqual({ main: null, seed: null, gone: null, old: null, arr: null });
  });
});
