import { describe, expect, it, vi } from 'vitest';
import { toggleFullscreen } from '@/lib/jellyfin-playback/browser';

/**
 * Cover for the iPhone fullscreen gap found testing the player against a real
 * Jellyfin 10.11.11 library: iPhone Safari implements no element Fullscreen
 * API, so the standard call resolved to `undefined` and the button did nothing
 * at all in the installed PWA. jellyfin-web falls back to the video element's
 * own surface (playbackmanager.js `toggleFullscreen`).
 */

interface FakeDoc {
  fullscreenElement: Element | null;
  exitFullscreen: () => Promise<void>;
  webkitIsFullScreen?: boolean;
  webkitCancelFullscreen?: () => void;
}

function surfaces(options: {
  requestFullscreen?: () => Promise<void>;
  doc?: Partial<FakeDoc>;
}) {
  const doc: FakeDoc = {
    fullscreenElement: null,
    exitFullscreen: vi.fn(() => Promise.resolve()),
    ...options.doc,
  };
  const root = { ownerDocument: doc, requestFullscreen: options.requestFullscreen };
  const video = { webkitEnterFullscreen: vi.fn() };
  return {
    doc,
    video,
    toggle: () => toggleFullscreen(
      root as unknown as Element,
      video as unknown as HTMLVideoElement,
    ),
  };
}

describe('toggleFullscreen', () => {
  it('uses the video element on a browser with no element Fullscreen API', () => {
    // The iPhone: `Element.prototype.requestFullscreen` is simply absent.
    const { video, toggle } = surfaces({});
    toggle();
    expect(video.webkitEnterFullscreen).toHaveBeenCalledOnce();
  });

  it('prefers the standard API where it exists', () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    const { video, toggle } = surfaces({ requestFullscreen });
    toggle();
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(video.webkitEnterFullscreen).not.toHaveBeenCalled();
  });

  it('falls back to the video when the standard request is refused', async () => {
    // A permissions policy rejects rather than throwing, which `void` left as
    // an unhandled rejection in the console instead of feedback to anybody.
    const requestFullscreen = vi.fn(() => Promise.reject(new TypeError('not granted')));
    const { video, toggle } = surfaces({ requestFullscreen });
    toggle();
    await Promise.resolve();
    await Promise.resolve();
    expect(video.webkitEnterFullscreen).toHaveBeenCalledOnce();
  });

  it('exits through the standard API when already fullscreen', () => {
    const { doc, video, toggle } = surfaces({
      requestFullscreen: vi.fn(() => Promise.resolve()),
      doc: { fullscreenElement: {} as Element },
    });
    toggle();
    expect(doc.exitFullscreen).toHaveBeenCalledOnce();
    expect(video.webkitEnterFullscreen).not.toHaveBeenCalled();
  });

  it('exits through the webkit surface when that is what is fullscreen', () => {
    const webkitCancelFullscreen = vi.fn();
    const { video, toggle } = surfaces({
      doc: { webkitIsFullScreen: true, webkitCancelFullscreen },
    });
    toggle();
    expect(webkitCancelFullscreen).toHaveBeenCalledOnce();
    expect(video.webkitEnterFullscreen).not.toHaveBeenCalled();
  });
});
