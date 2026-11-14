/**
 * A playback failure whose message was written for the viewer: Helprr's own
 * wording, or the server's answer. Anything else a start throws is the
 * browser's (a DOMException from `play()`, a network TypeError), whose message
 * is the engine's and is not shown; see `startFailureMessage`.
 */
export class PlaybackFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaybackFailure';
  }
}

/**
 * How long a paused start waits for the browser to load the stream by itself
 * before it falls back to playing it. iOS Safari may load nothing until
 * `play()`; everything else buffers a paused element.
 */
const PAUSED_LOAD_FALLBACK_MS = 4_000;

/**
 * Bound silent startup stalls even when the browser emits no media events.
 *
 * `paused` starts the stream without playing it: a track change or a seek made
 * while paused. Calling `play()` for those played a moment of the title, and
 * the element read as playing for the seconds the new stream took to load.
 * Ready once a frame is there; with metadata alone if the browser will not
 * buffer a paused element; and only if it has loaded nothing at all does it
 * play after all, leaving the caller to pause it, as before.
 */
export function playMedia(
  el: HTMLMediaElement,
  isCurrent: () => boolean,
  timeoutMs = 30_000,
  paused = false,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let playing = !paused;
    let playResolved = false;
    const finish = (ready: boolean, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      clearTimeout(fallback);
      if (error) reject(error);
      else resolve(ready);
    };
    const check = () => {
      if (!isCurrent()) finish(false);
      else if (!playing && el.readyState >= 2) finish(true);
      else if (playResolved && el.readyState >= 3) finish(true);
    };
    const poll = setInterval(check, 250);
    const timeout = setTimeout(() => {
      if (!isCurrent()) { finish(false); return; }
      el.pause();
      finish(false, new PlaybackFailure('Playback did not start. Try again or choose another quality.'));
    }, timeoutMs);
    const failed = (cause: unknown) => {
      // DOMExceptions can come from another realm and fail instanceof Error.
      const name = (typeof cause === 'object' && cause !== null && 'name' in cause
        ? String(cause.name) : '').toLowerCase();
      // These are user/browser intent, not evidence that the codec is broken.
      if (name === 'aborterror' || name === 'notallowederror') finish(false);
      else finish(false, cause);
    };
    const play = () => {
      playing = true;
      try {
        void el.play().then(() => { playResolved = true; check(); }, failed);
      } catch (cause) { failed(cause); }
    };
    const fallback = paused ? setTimeout(() => {
      if (!isCurrent()) finish(false);
      else if (el.readyState >= 1) finish(true);
      else play();
    }, PAUSED_LOAD_FALLBACK_MS) : undefined;
    if (paused) check();
    else play();
  });
}
