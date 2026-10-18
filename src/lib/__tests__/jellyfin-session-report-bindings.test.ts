import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ report: vi.fn(), playSession: vi.fn(), liveStream: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUserCapability: async () => ({ ok: true, user: { id: 'member' } }) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/service-helpers', () => ({ getJellyfinPlaybackContext: async () => ({ client: { reportPlayback: mocks.report } }) }));
vi.mock('@/lib/cache/jellyfin-catalog', () => ({ invalidateJellyfinCatalog: vi.fn() }));
vi.mock('@/lib/jellyfin-playback/session-reaper', () => ({ notePlaybackReport: vi.fn() }));
vi.mock('@/lib/jellyfin-playback/live-stream-binding', () => ({ playSessionBelongsTo: mocks.playSession, liveStreamBelongsTo: mocks.liveStream }));

import { POST } from '@/app/api/jellyfin/stream/session/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.report.mockResolvedValue(undefined);
  mocks.playSession.mockResolvedValue(true);
  mocks.liveStream.mockResolvedValue(true);
});

// A long direct stream makes no further media requests, so its progress reports
// keep its bindings alive. The check renews only a binding that already matches.
describe('playback reports and stream bindings', () => {
  it('renews the play session and live stream bindings a report names', async () => {
    const res = await POST(new NextRequest('http://helprr.test/api/jellyfin/stream/session', {
      method: 'POST',
      body: JSON.stringify({ event: 'progress', itemId: 'abcdef0123', deviceId: 'd1', playSessionId: 'session-1', liveStreamId: 'ls-1', positionTicks: 10 }),
    }));
    expect(res.status).toBe(200);
    expect(mocks.playSession).toHaveBeenCalledWith('member', 'session-1', 'abcdef0123');
    expect(mocks.liveStream).toHaveBeenCalledWith('member', 'ls-1', 'abcdef0123');
  });

  it('checks nothing when the report names no stream', async () => {
    await POST(new NextRequest('http://helprr.test/api/jellyfin/stream/session', {
      method: 'POST',
      body: JSON.stringify({ event: 'progress', itemId: 'abcdef0123', deviceId: 'd1' }),
    }));
    expect(mocks.playSession).not.toHaveBeenCalled();
    expect(mocks.liveStream).not.toHaveBeenCalled();
  });
});
