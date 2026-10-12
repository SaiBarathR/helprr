import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The device id and name become part of the Authorization header Helprr sends
// to Jellyfin, so this route bounds them as the other stream routes do.

const mocks = vi.hoisted(() => ({ auth: vi.fn(), stopActiveEncodings: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/service-helpers', () => ({
  getJellyfinPlaybackContext: async () => ({ client: { stopActiveEncodings: mocks.stopActiveEncodings } }),
}));
vi.mock('@/lib/api-error', () => ({
  jellyfinConnectGateResponse: async () => null,
  upstreamErrorResponse: () => new Response(null, { status: 502 }),
}));

import { POST } from '@/app/api/jellyfin/stream/stop-encodings/route';

const post = (body: unknown) => POST(new NextRequest('http://helprr.test/api/jellyfin/stream/stop-encodings', {
  method: 'POST',
  body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'member', role: 'member' } });
});

describe('POST /api/jellyfin/stream/stop-encodings', () => {
  it('stops the session for an ordinary device', async () => {
    const res = await post({ playSessionId: 'session-1', deviceId: 'helprr-pwa-0123', deviceName: 'Helprr (Safari)' });
    expect(res.status).toBe(200);
    expect(mocks.stopActiveEncodings).toHaveBeenCalledWith('session-1', 'helprr-pwa-0123', 'Helprr (Safari)');
  });

  it('refuses an oversized device id before calling Jellyfin', async () => {
    const res = await post({ playSessionId: 'session-1', deviceId: 'x'.repeat(129) });
    expect(res.status).toBe(400);
    expect(mocks.stopActiveEncodings).not.toHaveBeenCalled();
  });

  it('cuts a long device name to the length the other stream routes allow', async () => {
    await post({ playSessionId: 'session-1', deviceId: 'helprr-pwa-0123', deviceName: 'n'.repeat(5000) });
    expect(mocks.stopActiveEncodings).toHaveBeenCalledWith('session-1', 'helprr-pwa-0123', 'n'.repeat(80));
  });
});
