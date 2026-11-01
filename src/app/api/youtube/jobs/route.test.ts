import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  heartbeat: vi.fn(),
  video: vi.fn(),
  enqueue: vi.fn(),
  store: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'u', username: 'admin' } })) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: <T,>(handler: T) => handler }));
vi.mock('@/lib/db', () => ({
  prisma: {
    archiveWorkerHeartbeat: { findFirst: mocks.heartbeat },
    creatorVideo: { findUnique: mocks.video },
  },
}));
vi.mock('@/lib/archive/jobs', async (original) => ({
  ...await original<typeof import('@/lib/archive/jobs')>(),
  enqueueDownload: mocks.enqueue,
}));
vi.mock('@/lib/youtube/playlists', () => ({ storeVideoById: mocks.store }));

import { POST } from './route';

const post = (body: unknown) => POST(new NextRequest('http://test/api/youtube/jobs', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
}));

describe('queuing a YouTube download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.heartbeat.mockResolvedValue({ platforms: ['TWITCH', 'YOUTUBE'] });
    mocks.video.mockResolvedValue({ id: 'v' });
    mocks.enqueue.mockResolvedValue({ jobId: 'j', created: true });
  });

  it('refuses, and says why, until the worker has a YouTube folder', async () => {
    mocks.heartbeat.mockResolvedValue({ platforms: ['TWITCH'] });
    const response = await post({ videoId: 'v' });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Settings → YouTube');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('asks only among YouTube videos, so a Twitch id cannot be queued here', async () => {
    mocks.video.mockResolvedValue(null);
    expect((await post({ videoId: 'twitch-video' })).status).toBe(404);
    expect(mocks.video.mock.calls[0][0].where).toEqual({ id: 'twitch-video', platform: 'YOUTUBE' });
  });

  it('starts from the common choice', async () => {
    await post({ videoId: 'v' });
    expect(mocks.enqueue.mock.calls[0][0]).toMatchObject({
      platform: 'YOUTUBE',
      source: 'MANUAL',
      options: { quality: '1080', codec: 'compatible', sponsorblock: 'mark', reencode: false, chat: false },
    });
  });

  it('takes a real choice', async () => {
    await post({ videoId: 'v', options: { quality: '2160', codec: 'av1', sponsorblock: 'remove', keepForever: true } });
    expect(mocks.enqueue.mock.calls[0][0].options).toMatchObject({ quality: '2160', codec: 'av1', sponsorblock: 'remove', keepForever: true });
  });

  it('drops anything that is not a fixed choice, so it can never reach yt-dlp', async () => {
    await post({ videoId: 'v', options: { quality: 'worst/--exec rm', codec: '[vcodec', sponsorblock: 'all', reencode: 'yes' } });
    expect(mocks.enqueue.mock.calls[0][0].options).toMatchObject({ quality: '1080', codec: 'compatible', sponsorblock: 'mark', reencode: false });
  });

  it('stores a pasted video it has not seen, using only the id from the link', async () => {
    mocks.video.mockResolvedValue(null);
    mocks.store.mockResolvedValue('new-row');
    await post({ url: 'https://www.youtube.com/watch?v=ZoZ7m020aJQ&list=PLx&t=9' });
    expect(mocks.store).toHaveBeenCalledWith('ZoZ7m020aJQ');
    expect(mocks.enqueue.mock.calls[0][0]).toMatchObject({ videoId: 'new-row', source: 'URL' });
  });

  it('turns away a link that is not YouTube', async () => {
    expect((await post({ url: 'https://evil.example/watch?v=ZoZ7m020aJQ' })).status).toBe(404);
    expect(mocks.store).not.toHaveBeenCalled();
  });
});
