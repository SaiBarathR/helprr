// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

/**
 * Cover for the paused-intent latch in `restartWith`.
 *
 * Changing an audio track, a quality, or a subtitle that has to be burned in
 * restarts the stream, and a restart plays — so a paused title resumed. The
 * first fix read `mediaRef.current.paused` to decide, which held until a second
 * change arrived while the first was still attaching: `attachMedia` plays the
 * element so it will load and seek, so the second change read `false` and
 * resumed anyway.
 *
 * The rule these pin down is that the paused state carried across a restart
 * comes from what the viewer asked for, never from the element. Each test
 * therefore puts the element into the transient playing state before the
 * restart it is checking, which is exactly what broke the element-reading
 * version.
 */

let harness: Harness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

/** Start the item and settle, leaving it playing. */
async function playing(): Promise<Harness> {
  const h = await mountPlayback();
  harness = h;
  await h.act(async () => { await h.playback().playItem(ITEM); });
  expect(h.media.paused()).toBe(false);
  return h;
}

/** Start the item and pause it the way a viewer would. */
async function paused(): Promise<Harness> {
  const h = await playing();
  await h.act(() => { h.playback().togglePause(); });
  expect(h.media.paused()).toBe(true);
  return h;
}

/** The `isPaused` the most recent start reported to Jellyfin. */
function lastStartReport(h: Harness) {
  return [...h.reports].reverse().find((report) => report.event === 'playing');
}

describe('restart keeps the viewer\'s paused intent', () => {
  it('stays paused through a single track change', async () => {
    const h = await paused();
    await h.act(async () => { await h.playback().setAudioStream(2); });

    expect(h.media.paused()).toBe(true);
    expect(lastStartReport(h)?.isPaused).toBe(true);
    expect(h.requests.at(-1)?.audioStreamIndex).toBe(2);
  });

  it('stays paused when a second change lands while the first is still attaching', async () => {
    const h = await paused();

    // Catch a restart in flight, then put the element into the state
    // `attachMedia` leaves it in — playing, so it can load and seek — while the
    // viewer's intent is still paused. Reading the element here is what the
    // first fix did, and what this test exists to keep out.
    h.holdStreamInfo();
    const first = h.playback().setAudioStream(2);
    await h.act(async () => { await h.element().play(); });
    expect(h.media.paused()).toBe(false);

    const second = h.playback().setAudioStream(3);
    await h.act(async () => {
      h.releaseStreamInfo();
      await Promise.all([first, second]);
    });

    expect(h.media.paused()).toBe(true);
    expect(lastStartReport(h)?.isPaused).toBe(true);
    // The newest pick is the one that survives; `reserveStart` retires the
    // older chain rather than letting it land last.
    expect(h.requests.at(-1)?.audioStreamIndex).toBe(3);
  });

  it('keeps playing through a track change when it was playing', async () => {
    const h = await playing();
    await h.act(async () => { await h.playback().setAudioStream(2); });

    expect(h.media.paused()).toBe(false);
    expect(lastStartReport(h)?.isPaused).toBe(false);
  });

  it('comes back paused when a direct stream fails over to a transcode', async () => {
    const h = await paused();

    // The element reporting an error is what drops DirectPlay to a transcode.
    // That retry is the player's own recovery, not a request to start playing.
    await h.act(async () => {
      h.element().dispatchEvent(new Event('error'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(h.requests.length).toBeGreaterThan(1);
    expect(h.media.paused()).toBe(true);
    expect(lastStartReport(h)?.isPaused).toBe(true);
  });

  it('honours a pause taken from the lock screen', async () => {
    const h = await playing();

    // The Media Session handlers pause the element directly rather than going
    // through togglePause, so they have to reach the latch themselves.
    await h.act(() => { h.mediaSession.pause?.(); });
    expect(h.media.paused()).toBe(true);

    await h.act(async () => { await h.playback().setAudioStream(2); });

    expect(h.media.paused()).toBe(true);
    expect(lastStartReport(h)?.isPaused).toBe(true);
  });
});
