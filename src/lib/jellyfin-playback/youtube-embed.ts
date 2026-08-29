/**
 * YouTube IFrame Player API plumbing for the cinematic trailer backdrop.
 *
 * A bare `<iframe src=".../embed/KEY?autoplay=1">` can't be supervised: there
 * is no way to know whether it actually started, whether the video is even
 * embeddable, or what rendition it settled on. That produced three visible
 * problems — the provider's paused chrome sitting over a dead frame, "video
 * unavailable" cards where the artwork should have been, and a soft low
 * rendition. The player API answers all three, so it is worth the script.
 */

const API_SRC = 'https://www.youtube.com/iframe_api';

let apiPromise: Promise<typeof YT> | null = null;

/**
 * Loads the IFrame API once per document and resolves with the namespace.
 *
 * Content-Security-Policy: the production policy uses `strict-dynamic`, under
 * which a script injected by an already-trusted (nonced) script inherits that
 * trust — this module ships inside Next's nonced bundle, so no host allowance
 * is needed and adding one would be ignored. `frame-src` already permits
 * youtube.com for the existing trailer dialog.
 */
export function loadYouTubeIframeApi(): Promise<typeof YT> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('YouTube IFrame API requires a browser'));
      return;
    }
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    // The API calls exactly one global when it finishes loading, so chain
    // rather than clobber — another consumer may already be waiting.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube IFrame API loaded without a Player'));
    };

    const script = document.createElement('script');
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      apiPromise = null;
      reject(new Error('Failed to load the YouTube IFrame API'));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}

/** The video key from a Jellyfin RemoteTrailer URL, or null if it isn't YouTube. */
export function youtubeTrailerKey(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const key = host === 'youtu.be'
    ? parsed.pathname.slice(1)
    : host === 'youtube.com' || host === 'm.youtube.com'
      ? parsed.searchParams.get('v') ?? parsed.pathname.split('/').filter(Boolean).pop()
      : null;
  // Keys are a fixed alphabet; anything else came from a path we misread.
  return key && /^[\w-]{6,20}$/.test(key) ? key : null;
}

/**
 * Rendition to ask the player for, by viewport width.
 *
 * The owner's floor: a phone may sit at 480p, but a tablet or desktop must not
 * — those get 720p and 1080p respectively.
 */
export function targetTrailerQuality(viewportWidth: number): 'large' | 'hd720' | 'hd1080' {
  if (viewportWidth < 768) return 'large';
  if (viewportWidth < 1280) return 'hd720';
  return 'hd1080';
}

/** Vertical resolution matching {@link targetTrailerQuality}. */
export function targetTrailerHeight(viewportWidth: number): number {
  const quality = targetTrailerQuality(viewportWidth);
  if (quality === 'large') return 480;
  return quality === 'hd720' ? 720 : 1080;
}

/**
 * Slight crop past the cover box, to push the provider's title/channel overlay
 * off the top edge and its progress strip off the bottom. `modestbranding` no
 * longer suppresses either. Kept small — this is the magnification that made
 * trailers look soft in the first place, so it buys just enough.
 */
const TRAILER_OVERSCAN = 1.18;

/**
 * Layout for a 16:9 player that covers `width` x `height` with no letterboxing.
 *
 * Two things are going on. First, cover: the previous implementation simply
 * blew the iframe up to 220% of its frame, which magnified whatever rendition
 * arrived and is most of why trailers looked soft. This computes the exact
 * cover box instead, so nothing is scaled up beyond necessity.
 *
 * Second, rendition: YouTube picks quality from the player element's CSS size,
 * so a hero that is only 560px tall is offered 360p. Laying the element out at
 * `targetHeight` and scaling it back down asks for the rendition we actually
 * want and then downsamples it, which is sharper than upscaling a small one.
 */
export function trailerPlayerLayout(
  width: number,
  height: number,
  targetHeight: number,
): { width: number; height: number; scale: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0, scale: 1 };

  const coverWidth = Math.max(width, (height * 16) / 9) * TRAILER_OVERSCAN;
  const coverHeight = Math.max(height, (width * 9) / 16) * TRAILER_OVERSCAN;
  // Only ever oversample; never lay the player out smaller than it displays.
  const factor = Math.max(1, targetHeight / coverHeight);

  return {
    width: Math.round(coverWidth * factor),
    height: Math.round(coverHeight * factor),
    scale: 1 / factor,
  };
}
