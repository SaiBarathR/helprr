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
    creatorVideo: { findUnique: mocks.video, findUniqueOrThrow: vi.fn(async () => ({ id: 'v' })) },
  },
}));
vi.mock('@/lib/archive/jobs', async (original) => ({
  ...await original<typeof import('@/lib/archive/jobs')>(),
  enqueueDownload: mocks.enqueue,
}));
vi.mock('@/lib/youtube/playlists', () => ({ storeVideoById: mocks.store }));
vi.mock('@/lib/youtube/policy', async (original) => {
  const actual = await original<typeof import('@/lib/youtube/policy')>();
  return { ...actual, decideForYoutubeVideo: vi.fn(async () => ({ policy: actual.YOUTUBE_BUILT_IN_POLICY, trace: {}, autoDownloadReason: '' })) };
});

import { POST } from './route';

const post = (body: unknown) => POST(new NextRequest('http://test/api/youtube/jobs', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
}));

describe('queuing a YouTube download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.heartbeat.mockResolvedValue({ platforms: ['TWITCH', 'YOUTUBE'], lastSeenAt: new Date() });
    mocks.video.mockResolvedValue({ id: 'v' });
    mocks.enqueue.mockResolvedValue({ jobId: 'j', created: true });
  });

  it('refuses, and says why, until the worker has a YouTube folder', async () => {
    mocks.heartbeat.mockResolvedValue({ platforms: ['TWITCH'], lastSeenAt: new Date() });
    const response = await post({ videoId: 'v' });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Settings → YouTube');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('does not trust the last word of a worker that has gone', async () => {
    mocks.heartbeat.mockResolvedValue({ platforms: ['TWITCH', 'YOUTUBE'], lastSeenAt: new Date(Date.now() - 10 * 60_000) });
    const response = await post({ videoId: 'v' });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('offline');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('rides out a worker restart', async () => {
    mocks.heartbeat.mockResolvedValue({ platforms: ['TWITCH', 'YOUTUBE'], lastSeenAt: new Date(Date.now() - 60_000) });
    expect((await post({ videoId: 'v' })).status).toBe(201);
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

  it('starts a rule download that is still waiting, and says so', async () => {
    mocks.enqueue.mockResolvedValue({ jobId: 'j', created: false, startedNow: true });
    const response = await post({ videoId: 'v', options: { quality: '2160' } });
    expect(mocks.enqueue.mock.calls[0][0]).toMatchObject({
      startWaitingRuleJob: true,
      source: 'MANUAL',
      actor: { id: 'u', username: 'admin' },
      options: { quality: '2160' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobId: 'j', created: false, startedNow: true });
  });

  it('tells a download already under way apart from one it started', async () => {
    mocks.enqueue.mockResolvedValue({ jobId: 'j', created: false });
    const response = await post({ videoId: 'v' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobId: 'j', created: false });
  });

  it('starts nothing for someone who may not download', async () => {
    const { requireUserCapability } = await import('@/lib/auth');
    vi.mocked(requireUserCapability).mockResolvedValueOnce({ ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) } as never);
    expect((await post({ videoId: 'v' })).status).toBe(403);
    expect(requireUserCapability).toHaveBeenCalledWith('youtube.download');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('takes a real choice', async () => {
    await post({ videoId: 'v', options: { quality: '2160', codec: 'av1', sponsorblock: 'remove', keepForever: true } });
    expect(mocks.enqueue.mock.calls[0][0].options).toMatchObject({ quality: '2160', codec: 'av1', sponsorblock: 'remove', keepForever: true });
  });

  it('passes on the copy the sheet showed, cut to a sane length', async () => {
    await post({ videoId: 'v', options: { formatId: '401', hdr: true } });
    expect(mocks.enqueue.mock.calls[0][0].options).toMatchObject({ formatId: '401', hdr: true });
    mocks.enqueue.mockClear();
    await post({ videoId: 'v', options: { formatId: 'x'.repeat(500) } });
    expect(mocks.enqueue.mock.calls[0][0].options.formatId).toHaveLength(32);
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
