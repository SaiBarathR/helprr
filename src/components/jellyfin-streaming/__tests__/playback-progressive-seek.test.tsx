// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

/**
 * A progressive (non-HLS) transcode, which a browser with no HLS at all gets
 * for audio. Jellyfin serves it from the requested position without copied
 * timestamps, so a seek is a stop and a fresh stream, and the element's clock
 * starts at zero of it.
 *
 * Found live on Jellyfin 12.2.0: the restarted element was also seeked to the
 * absolute position, which is the end of a stream that only holds what is
 * left, so it ended at once and the queue moved on to the next track. And the
 * restart dropped a paused title's pause.
 */

let harness: Harness | null = null;
afterEach(() => {
  harness?.cleanup();
  harness = null;
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function seekTo(h: Harness, seconds: number) {
  await h.act(async () => {
    h.playback().seek(seconds);
    for (let i = 0; i < 10; i += 1) await flush();
  });
}

async function timeupdate(h: Harness, elementSeconds: number) {
  await h.act(() => {
    h.element().currentTime = elementSeconds;
    h.element().dispatchEvent(new Event('timeupdate'));
  });
}

describe('seeking a progressive transcode', () => {
  it('restarts at the target and plays from the start of the new stream', async () => {
    const h = await mountPlayback({ progressive: true });
    harness = h;
    await h.act(async () => { await h.playback().playItem(ITEM); });
    await timeupdate(h, 30);

    await seekTo(h, 600);

    expect(h.encodingStops).toEqual(['session-1']);
    expect(h.requests.at(-1)?.startTimeTicks).toBe(600 * 10_000_000);
    // Not moved to 600: the new stream already begins there. (The fake element
    // keeps its clock across sources; a real one starts the new one at zero.)
    expect(h.media.currentTime()).not.toBe(600);
    expect(h.media.paused()).toBe(false);
  });

  it('counts the position from where the stream was started', async () => {
    const h = await mountPlayback({ progressive: true });
    harness = h;
    await h.act(async () => { await h.playback().playItem(ITEM); });
    await seekTo(h, 600);
    await timeupdate(h, 5);

    // A ten-second skip from 605 s asks for 615 s, not 15 s.
    await h.act(async () => {
      h.playback().skip(10);
      for (let i = 0; i < 10; i += 1) await flush();
    });
    expect(h.requests.at(-1)?.startTimeTicks).toBe(615 * 10_000_000);
  });

  it('keeps a paused title paused', async () => {
    const h = await mountPlayback({ progressive: true });
    harness = h;
    await h.act(async () => { await h.playback().playItem(ITEM); });
    await h.act(() => { h.playback().togglePause(); });
    expect(h.media.paused()).toBe(true);

    await seekTo(h, 300);

    expect(h.requests.at(-1)?.startTimeTicks).toBe(300 * 10_000_000);
    expect(h.media.paused()).toBe(true);
    expect([...h.reports].reverse().find((report) => report.event === 'playing')?.isPaused).toBe(true);
  });
});
