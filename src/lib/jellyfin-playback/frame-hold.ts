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
 * loading, audio only) or the browser gives no 2D canvas.
 */
export function holdFrame(el: HTMLVideoElement): FrameHold | null {
  const parent = el.parentElement;
  if (!parent || el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !el.videoWidth || !el.videoHeight) return null;
  const canvas = document.createElement('canvas');
  canvas.width = el.videoWidth;
  canvas.height = el.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  try {
    context.drawImage(el, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  // Fitted as the element fits its picture (letterboxed, or cropped by the
  // player's zoom to fill), over the same box. The element's positioned
  // ancestor is the player surface, which it fills.
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.frameHold = '';
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    objectFit: getComputedStyle(el).objectFit || 'contain',
    background: 'black',
    pointerEvents: 'none',
  });
  el.after(canvas);
  return { release: () => canvas.remove() };
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Call `onFrame` once `el` presents a frame of the source it was just given.
 * Returns a cancel. Where the browser cannot report presented frames, the
 * first loaded frame stands in for it.
 */
export function whenFramePresented(el: HTMLVideoElement, onFrame: () => void): () => void {
  const video = el as FrameCallbackVideo;
  if (typeof video.requestVideoFrameCallback === 'function') {
    const handle = video.requestVideoFrameCallback(onFrame);
    return () => video.cancelVideoFrameCallback?.(handle);
  }
  el.addEventListener('loadeddata', onFrame, { once: true });
  return () => el.removeEventListener('loadeddata', onFrame);
}
