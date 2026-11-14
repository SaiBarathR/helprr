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

/** Bound silent startup stalls even when the browser emits no media events. */
export function playMedia(
  el: HTMLMediaElement,
  isCurrent: () => boolean,
  timeoutMs = 30_000,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let playResolved = false;
    const finish = (ready: boolean, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(ready);
    };
    const check = () => {
      if (!isCurrent()) finish(false);
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
    try {
      void el.play().then(() => { playResolved = true; check(); }, failed);
    } catch (cause) { failed(cause); }
  });
}
