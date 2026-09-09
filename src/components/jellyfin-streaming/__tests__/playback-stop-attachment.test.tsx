// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

const hls = vi.hoisted(() => ({ manifests: [] as (() => void)[] }));
vi.mock('@/lib/jellyfin-playback/browser', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/jellyfin-playback/browser')>(),
  canPlayHlsWithMse: () => true,
  canPlayNativeHls: () => false,
}));
vi.mock('hls.js', () => ({
  default: class {
    static isSupported() { return true; }
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest' };
    on() {}
    once(_event: string, ready: () => void) { hls.manifests.push(ready); }
    loadSource() {}
    attachMedia(el: HTMLMediaElement) { el.src = 'blob:test-hls'; }
    destroy() {}
  },
}));

let harness: Harness | null = null;
afterEach(() => {
  hls.manifests.forEach((ready) => ready());
  hls.manifests = [];
  harness?.releaseStopReport();
  harness?.releaseEncodingStop();
  harness?.cleanup();
  harness = null;
});

describe('Stop while HLS is attaching', () => {
  it('does not resume after the old manifest arrives during delayed stop cleanup', async () => {
    const h = await mountPlayback({ hls: true });
    harness = h;
    let starting!: Promise<void>;
    await h.act(async () => {
      starting = h.playback().playItem(ITEM);
      await vi.waitFor(() => expect(hls.manifests).toHaveLength(1));
    });
    h.holdStopRequests();
    let stopped!: Promise<void>;
    await h.act(() => { stopped = h.playback().stop(); });
    await h.act(async () => { hls.manifests[0](); await starting; });

    expect(h.media.paused()).toBe(true);
    expect(h.element().hasAttribute('src')).toBe(false);
    expect(h.playback().status).toBe('idle');
    expect(h.reports.some(({ event }) => event === 'playing')).toBe(false);
    await h.act(async () => { h.releaseStopReport(); h.releaseEncodingStop(); await stopped; });
  });

  it('leaves a newer paused player alone when the retired manifest arrives', async () => {
    const h = await mountPlayback({ hls: true });
    harness = h;
    let first!: Promise<void>;
    await h.act(async () => {
      first = h.playback().playItem(ITEM);
      await vi.waitFor(() => expect(hls.manifests).toHaveLength(1));
    });
    await h.act(async () => { await h.playback().stop(); });
    let second!: Promise<void>;
    await h.act(async () => {
      second = h.playback().playItem({ ...ITEM, Id: 'item-2' });
      await vi.waitFor(() => expect(hls.manifests).toHaveLength(2));
      hls.manifests[1]();
      await second;
    });
    await h.act(() => { h.playback().togglePause(); });
    await h.act(async () => { hls.manifests[0](); await first; });
    expect(h.playback().stream?.playSessionId).toBe('session-2');
    expect(h.playback().item?.Id).toBe('item-2');
    expect(h.media.paused()).toBe(true);
    expect(h.playback().status).toBe('paused');
  });
});
