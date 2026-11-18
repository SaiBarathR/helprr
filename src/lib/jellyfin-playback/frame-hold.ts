/**
 * The picture on screen while the player's element loads a new stream of the
 * same title (an audio, subtitle or quality change).
 *
 * Giving the element a new source clears it to black until the new stream has
 * a frame. On an iPhone that is the whole reload of a transcode, 8–15 s for 4K,
 * and a paused element there shows no frame of its new stream at all until
 * Play. So the frame on screen is drawn into a canvas laid over the element
 * first, and the canvas goes once the element presents a frame of its own.
 */
/** The most pixels a held frame keeps: 1920×1080's worth, about 8 MB. */
export const HOLD_PIXEL_BUDGET = 1920 * 1080;

export interface FrameHold {
  release: () => void;
}

/**
 * Draw `el`'s current frame over it. Null when it has no frame to keep (still
 * loading, audio only, a frame that is all black), or the browser gives no 2D
 * canvas.
 */
export function holdFrame(el: HTMLVideoElement): FrameHold | null {
  const parent = el.parentElement;
  const { videoWidth: width, videoHeight: height } = el;
  if (!parent || el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !width || !height) return null;
  // The whole frame, so it stays right however the box changes during the
  // hold (the mini player letterboxes it, Fill crops it, a rotation reshapes
  // it), at no more pixels than it can show: enough to cover the box at the
  // screen's density, and never past HOLD_PIXEL_BUDGET. A 4K frame at full
  // size is ~33 MB, which counts against iOS's canvas memory.
  const dpr = window.devicePixelRatio || 1;
  const cover = Math.max(el.clientWidth / width, el.clientHeight / height) * dpr;
  const scale = Math.min(1, cover || 1, Math.sqrt(HOLD_PIXEL_BUDGET / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  try {
    context.drawImage(el, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  // An all-black frame (a decoder that has not drawn yet, or a fade) holds
  // nothing the black element does not already show.
  if (allBlack(canvas)) {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }
  // Over the same box: the element's positioned ancestor is the player
  // surface, which it fills. Fitted by globals.css like the element, so the
  // player's zoom to fill and the mini player crop it the same way.
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.frameHold = '';
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    background: 'black',
    pointerEvents: 'none',
  });
  el.after(canvas);
  return {
    release: () => {
      canvas.remove();
      // Frees the bitmap now rather than at the next collection, which WebKit
      // may put off while the canvas memory limit counts it.
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

/** The frame shrunk to 4×4 and read back once, all near black. A canvas that
 *  cannot be read back counts as not black: the frame is held as before. */
function allBlack(frame: HTMLCanvasElement): boolean {
  const sample = document.createElement('canvas');
  sample.width = 4;
  sample.height = 4;
  try {
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(frame, 0, 0, 4, 4);
    const pixels = context.getImageData(0, 0, 4, 4).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    sample.width = 0;
    sample.height = 0;
  }
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** After `playing`, how long a hold may stay before it goes regardless. */
export const PLAYING_RELEASE_MS = 1_200;

/**
 * Call `onFrame` once `el` shows a frame of the source it was just given, on
 * the first sign of one:
 * - a presented frame (`requestVideoFrameCallback`), where the browser
 *   reports them; Safari's own HLS never did, and an element under the
 *   held frame may not be composited at all;
 * - playback moving: `playing`, then the time advancing past where it began;
 * - `PLAYING_RELEASE_MS` after `playing`, in case neither of those comes;
 * - the first loaded frame, where presented frames cannot be reported.
 *
 * `afterPlay`: Safari's own HLS. A paused element of it shows no frame of a
 * new stream until Play, yet WebKit can still report one presented, or
 * loaded, while the picture stays black. So for it a frame only counts once
 * the element plays; one reported while paused waits for the next. Returns a
 * cancel.
 */
export function whenFramePresented(el: HTMLVideoElement, onFrame: () => void, { afterPlay = false } = {}): () => void {
  const video = el as FrameCallbackVideo;
  let done = false;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let handle: number | undefined;
  const cancel = () => {
    done = true;
    clearTimeout(timer);
    if (handle !== undefined) video.cancelVideoFrameCallback?.(handle);
    el.removeEventListener('playing', onPlaying);
    el.removeEventListener('timeupdate', onTime);
    el.removeEventListener('loadeddata', onLoaded);
  };
  function finish() {
    if (done) return;
    cancel();
    onFrame();
  }
  const unseen = () => afterPlay && el.paused;
  function onPresented() {
    if (done) return;
    if (unseen()) handle = video.requestVideoFrameCallback?.(onPresented);
    else finish();
  }
  function onLoaded() {
    if (!unseen()) finish();
  }
  function onPlaying() {
    startedAt = el.currentTime;
    clearTimeout(timer);
    timer = setTimeout(finish, PLAYING_RELEASE_MS);
  }
  function onTime() {
    if (!el.paused && el.currentTime > startedAt && el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      if (timer !== undefined) finish();
    }
  }
  el.addEventListener('playing', onPlaying);
  el.addEventListener('timeupdate', onTime);
  if (typeof video.requestVideoFrameCallback === 'function') handle = video.requestVideoFrameCallback(onPresented);
  else el.addEventListener('loadeddata', onLoaded);
  return cancel;
}
