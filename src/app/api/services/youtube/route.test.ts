import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  stored: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  resetCounts: vi.fn(),
  existing: null as { id: string } | null,
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'admin' } })) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: <T,>(handler: T) => handler }));
vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: { findFirst: vi.fn(async () => mocks.existing), update: mocks.update, create: mocks.create },
    youtubeSettings: { updateMany: mocks.resetCounts },
  },
}));
vi.mock('@/lib/twitch/token-cipher', () => ({ encryptTwitchToken: (value: string) => `enc:${value}` }));
vi.mock('@/lib/youtube/api', async (original) => ({
  ...await original<typeof import('@/lib/youtube/api')>(),
  verifyYoutubeKey: mocks.verify,
  storedApiKey: mocks.stored,
}));

import { YoutubeKeyRejectedError, YoutubeQuotaError } from '@/lib/youtube/api';
import { POST } from './route';

const NEW_KEY = 'not-a-real-new-key';
const save = (apiKey: string) => POST(new NextRequest('http://test/api/services/youtube', {
  method: 'POST',
  body: JSON.stringify({ apiKey }),
  headers: { 'content-type': 'application/json' },
}));

describe('saving the YouTube key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue(undefined);
    mocks.stored.mockResolvedValue('not-a-real-old-key');
    mocks.existing = { id: 'connection' };
  });

  it('stores it encrypted and starts a new count for a different key', async () => {
    expect((await save(NEW_KEY)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'connection' },
      data: { url: 'https://www.googleapis.com/youtube/v3', apiKey: `enc:${NEW_KEY}` },
    });
    expect(mocks.resetCounts).toHaveBeenCalledWith({ data: { quotaUsed: 0, quotaSearches: 0 } });
  });

  it('keeps the count when the same key is saved again', async () => {
    mocks.stored.mockResolvedValue(NEW_KEY);
    expect((await save(NEW_KEY)).status).toBe(200);
    expect(mocks.resetCounts).not.toHaveBeenCalled();
  });

  it('saves a key Google accepted but has no quota left for', async () => {
    mocks.verify.mockRejectedValue(new YoutubeQuotaError());
    expect((await save(NEW_KEY)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalled();
  });

  it('refuses a key Google rejected, and leaves the stored one', async () => {
    mocks.verify.mockRejectedValue(new YoutubeKeyRejectedError());
    expect((await save(NEW_KEY)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.resetCounts).not.toHaveBeenCalled();
  });

  it('stores nothing when YouTube cannot be reached', async () => {
    mocks.verify.mockRejectedValue(new Error('YouTube request failed: 503'));
    expect((await save(NEW_KEY)).status).toBe(502);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
