// Media engine selection (plan §B): direct play / direct stream use a plain
// <video src>; transcoded HLS plays natively on Safari/iOS and through a
// lazy-imported hls.js everywhere else. Browser-only.

export interface PlaybackEngine {
  kind: 'native' | 'hls';
  destroy: () => void;
}

function attachNative(video: HTMLVideoElement, url: string): PlaybackEngine {
  video.src = url;
  return {
    kind: 'native',
    destroy: () => {
      video.removeAttribute('src');
      video.load();
    },
  };
}

const MAX_HLS_RETRIES = 3;

// Recent Chrome also answers "maybe" for native HLS, but per plan §B only
// Safari/iOS gets the native pipeline — hls.js has far better-proven buffer
// control and error recovery for Jellyfin streams on Chromium/Firefox.
function isSafari(): boolean {
  return /apple/i.test(navigator.vendor ?? '');
}

export async function attachSource(
  video: HTMLVideoElement,
  url: string,
  isHls: boolean,
  onFatalError: (message: string) => void
): Promise<PlaybackEngine> {
  if (!isHls) {
    return attachNative(video, url);
  }
  const canPlayNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
  if (canPlayNativeHls && (isSafari() || typeof MediaSource === 'undefined')) {
    return attachNative(video, url);
  }

  const { default: Hls } = await import('hls.js');
  if (!Hls.isSupported()) {
    // No usable MSE — last-ditch native attempt.
    return attachNative(video, url);
  }

  const hls = new Hls({
    // Jellyfin serves a single-variant stream (quality is renegotiated
    // server-side via the quality menu), so no ABR capping config is needed.
    maxBufferLength: 30,
    backBufferLength: 90,
  });
  let destroyed = false;
  let networkRetries = 0;
  let mediaRecoveries = 0;
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal || destroyed) return;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < MAX_HLS_RETRIES) {
      networkRetries += 1;
      hls.startLoad();
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < MAX_HLS_RETRIES) {
      mediaRecoveries += 1;
      hls.recoverMediaError();
      return;
    }
    onFatalError(`Playback failed: ${data.details ?? data.type}`);
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return {
    kind: 'hls',
    destroy: () => {
      destroyed = true;
      hls.destroy();
    },
  };
}
