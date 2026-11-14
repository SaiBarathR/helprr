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
  // No more pixels than the screen shows: a 4K frame at full size is ~33 MB,
  // which counts against iOS's canvas memory. Letterboxed, the whole frame is
  // shown at the smaller of the two ratios. Cropped by Fill, only the middle
  // that fills the box is shown, at the larger ratio: just that part is kept,
  // so the canvas has the box's shape and Fill shows all of it.
  const dpr = window.devicePixelRatio || 1;
  const boxWidth = el.clientWidth;
  const boxHeight = el.clientHeight;
  let source = { x: 0, y: 0, width, height };
  let shown = Math.min(boxWidth / width, boxHeight / height);
  if (el.hasAttribute('data-fill') && boxWidth && boxHeight) {
    shown = Math.max(boxWidth / width, boxHeight / height);
    const cropWidth = Math.min(width, boxWidth / shown);
    const cropHeight = Math.min(height, boxHeight / shown);
    source = { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight };
  }
  const scale = Math.min(1, shown * dpr || 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  try {
    context.drawImage(el, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  // An all-black frame (a decoder that has not drawn yet, or a fade) holds
  // nothing the black element does not already show.
  if (allBlack(context, canvas.width, canvas.height)) {
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

/** Sixteen points across the frame, all near black. A canvas that cannot be
 *  read back counts as not black: the frame is held as before. */
function allBlack(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) {
        const x = Math.min(width - 1, Math.floor((column + 0.5) * width / 4));
        const y = Math.min(height - 1, Math.floor((row + 0.5) * height / 4));
        const [r, g, b] = context.getImageData(x, y, 1, 1).data;
        if (r > 8 || g > 8 || b > 8) return false;
      }
    }
    return true;
  } catch {
    return false;
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
 * A paused element of Safari's own HLS shows no frame of a new stream until
 * Play, so none of these comes while it stays paused. Returns a cancel.
 */
export function whenFramePresented(el: HTMLVideoElement, onFrame: () => void): () => void {
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
    el.removeEventListener('loadeddata', finish);
  };
  function finish() {
    if (done) return;
    cancel();
    onFrame();
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
  if (typeof video.requestVideoFrameCallback === 'function') handle = video.requestVideoFrameCallback(finish);
  else el.addEventListener('loadeddata', finish);
  return cancel;
}
