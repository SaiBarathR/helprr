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
 * How a paused start knows the stream is there without playing it.
 *
 * `buffered`: a frame is loaded (readyState 2); hls.js and progressive files
 * get there on a paused element. `native`: metadata (readyState 1) is enough,
 * because Safari's own HLS — every iPhone — usually stops there until `play()`,
 * and waiting for a frame only ran the fallback. Either way, a stream that has
 * loaded nothing after `fallbackMs` is played to make the browser load it:
 * muted, and paused the moment it plays. 4 s for both: on iOS cellular a fresh
 * transcode's playlist alone can take 2–4 s, and metadata arriving any time
 * before that is still taken at once.
 */
export const PAUSED_START = {
  buffered: { readyState: 2, fallbackMs: 4_000 },
  native: { readyState: 1, fallbackMs: 4_000 },
} as const;
type PausedStart = (typeof PAUSED_START)[keyof typeof PAUSED_START];

/**
 * Bound silent startup stalls even when the browser emits no media events.
 *
 * `paused` starts the stream without playing it: a track change or a seek made
 * while paused. Calling `play()` for those played a moment of the title, and
 * the element read as playing for the seconds the new stream took to load.
 * Ready at the readiness `paused` names; with metadata alone if the browser
 * will not buffer further by its fallback; and only if it has loaded nothing
 * at all is it played, without sound and only until `play()` resolves, then
 * waited on paused like the rest.
 */
export function playMedia(
  el: HTMLMediaElement,
  isCurrent: () => boolean,
  timeoutMs = 30_000,
  paused: PausedStart | null = null,
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
      else if (!playing && paused && el.readyState >= paused.readyState) finish(true);
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
    // The element's own mute is borrowed and handed back; the viewer's mute
    // setting lives in the provider and is not touched.
    const nudge = () => {
      const wasMuted = el.muted;
      const restore = () => { el.muted = wasMuted; };
      el.muted = true;
      playing = true;
      try {
        void el.play().then(() => {
          el.pause();
          restore();
          playing = false;
          check();
        }, (cause) => { restore(); failed(cause); });
      } catch (cause) { restore(); failed(cause); }
    };
    const fallback = paused ? setTimeout(() => {
      if (!isCurrent()) finish(false);
      else if (el.readyState >= 1) finish(true);
      else nudge();
    }, paused.fallbackMs) : undefined;
    if (paused) check();
    else play();
  });
}
