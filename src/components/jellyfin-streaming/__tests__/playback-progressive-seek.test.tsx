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

    // A ten-second skip from 605 s asks for 615 s, not 15 s, once the run of
    // skips has stopped gathering.
    await h.act(async () => {
      h.playback().skip(10);
      await new Promise((resolve) => setTimeout(resolve, 450));
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

  it('adds up quick skips and restarts once, at where they land', async () => {
    const h = await mountPlayback({ progressive: true });
    harness = h;
    await h.act(async () => { await h.playback().playItem(ITEM); });
    await timeupdate(h, 100);
    const before = h.requests.length;

    await h.act(async () => {
      h.playback().skip(10);
      h.playback().skip(10);
      h.playback().skip(10);
    });
    // The clock shows the landing point straight away.
    expect(h.playback().positionSeconds).toBe(130);
    // The old stream's clock does not drag it back while the run gathers.
    await timeupdate(h, 101);
    expect(h.playback().positionSeconds).toBe(130);

    await h.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      for (let i = 0; i < 10; i += 1) await flush();
    });
    expect(h.requests.length).toBe(before + 1);
    expect(h.requests.at(-1)?.startTimeTicks).toBe(130 * 10_000_000);
    expect(h.encodingStops).toEqual(['session-1']);
  });

  it('counts a skip pressed during a restart from the restart\'s target', async () => {
    const h = await mountPlayback({ progressive: true });
    harness = h;
    await h.act(async () => { await h.playback().playItem(ITEM); });
    await timeupdate(h, 100);

    // The seek's restart is still in flight (no flush) when the skip comes.
    await h.act(async () => {
      h.playback().seek(300);
      h.playback().skip(10);
      await new Promise((resolve) => setTimeout(resolve, 450));
      for (let i = 0; i < 10; i += 1) await flush();
    });
    expect(h.requests.at(-1)?.startTimeTicks).toBe(310 * 10_000_000);
  });

  it('lets a later seek win over a run of skips still gathering', async () => {
    const h = await mountPlayback({ progressive: true });
    harness = h;
    await h.act(async () => { await h.playback().playItem(ITEM); });
    await timeupdate(h, 100);

    await h.act(async () => {
      h.playback().skip(10);
      h.playback().seek(3000);
      await new Promise((resolve) => setTimeout(resolve, 450));
      for (let i = 0; i < 10; i += 1) await flush();
    });
    expect(h.requests.at(-1)?.startTimeTicks).toBe(3000 * 10_000_000);
  });

  it('keeps a skip pressed while the run\'s own restart is landing', async () => {
    const h = await mountPlayback({ progressive: true });
    harness = h;
    await h.act(async () => { await h.playback().playItem(ITEM); });
    await timeupdate(h, 100);

    await h.act(async () => {
      h.playback().skip(10);
      // The run fires and its restart begins; no flush, so it has not landed.
      await new Promise((resolve) => setTimeout(resolve, 420));
      h.playback().skip(10);
      for (let i = 0; i < 10; i += 1) await flush();
      await new Promise((resolve) => setTimeout(resolve, 450));
      for (let i = 0; i < 10; i += 1) await flush();
    });
    expect(h.requests.at(-1)?.startTimeTicks).toBe(120 * 10_000_000);
  });

  it('keeps a run of skips still gathering when a track change restarts the stream', async () => {
    const h = await mountPlayback({ progressive: true });
    harness = h;
    await h.act(async () => { await h.playback().playItem(ITEM); });
    await timeupdate(h, 100);
    const before = h.requests.length;

    await h.act(async () => {
      h.playback().skip(10);
      h.playback().skip(10);
      // Inside the run's window: the restart takes the run with it.
      await h.playback().setAudioStream(2);
      for (let i = 0; i < 10; i += 1) await flush();
      await new Promise((resolve) => setTimeout(resolve, 450));
      for (let i = 0; i < 10; i += 1) await flush();
    });
    // One restart, at where the run was landing, with the new track; the run's
    // own timer does not fire a second one.
    expect(h.requests.length).toBe(before + 1);
    expect(h.requests.at(-1)?.startTimeTicks).toBe(120 * 10_000_000);
    expect(h.requests.at(-1)?.audioStreamIndex).toBe(2);
  });

  it('restarts at a seek\'s target when a track change overtakes it in flight', async () => {
    const h = await mountPlayback({ progressive: true });
    harness = h;
    await h.act(async () => { await h.playback().playItem(ITEM); });
    await timeupdate(h, 100);

    await h.act(async () => {
      // The seek's restart is still stopping the old stream (no flush).
      h.playback().seek(600);
      await h.playback().setAudioStream(2);
      for (let i = 0; i < 10; i += 1) await flush();
    });
    expect(h.requests.at(-1)?.startTimeTicks).toBe(600 * 10_000_000);
    expect(h.requests.at(-1)?.audioStreamIndex).toBe(2);
  });

  it('keeps the skip when a second track change supersedes the first while it attaches', async () => {
    const h = await mountPlayback({ progressive: true });
    harness = h;
    await h.act(async () => { await h.playback().playItem(ITEM); });
    await timeupdate(h, 100);

    h.holdStreamInfo();
    await h.act(async () => { h.playback().skip(10); });
    const first = h.playback().setAudioStream(2);
    await h.act(async () => { for (let i = 0; i < 10; i += 1) await flush(); });
    const second = h.playback().setAudioStream(3);
    await h.act(async () => {
      h.releaseStreamInfo();
      await Promise.all([first, second]);
      for (let i = 0; i < 10; i += 1) await flush();
    });
    expect(h.requestOnPlayer()?.startTimeTicks).toBe(110 * 10_000_000);
    expect(h.requestOnPlayer()?.audioStreamIndex).toBe(3);
  });
});
