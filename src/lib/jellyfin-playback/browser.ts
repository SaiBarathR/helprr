/**
 * Browser capability flags used by the Jellyfin Web device profile.
 * Ported from jellyfin-web v10.11.1 `src/scripts/browser.js` for Helprr's
 * targets: macOS/iOS/iPad/Android PWAs and desktop browsers over Tailscale.
 * TV shells (Tizen/webOS/Xbox/PS4) are treated as unsupported here.
 */

export interface HelprrBrowser {
  chrome: boolean;
  edgeChromium: boolean;
  firefox: boolean;
  safari: boolean;
  opera: boolean;
  iOS: boolean;
  iOSVersion: number;
  osx: boolean;
  android: boolean;
  mobile: boolean;
  windows: boolean;
  versionMajor: number;
}

function iOSVersion(ua: string): number {
  const match = ua.match(/OS (\d+)_(\d+)/);
  if (match) return parseFloat(`${match[1]}.${match[2]}`);
  const ipadOs = ua.match(/Version\/(\d+)\.(\d+)/);
  if (ipadOs && /iPad|Macintosh/.test(ua)) return parseFloat(`${ipadOs[1]}.${ipadOs[2]}`);
  return 0;
}

function versionMajor(ua: string, name: string): number {
  const match = ua.match(new RegExp(`${name}[/ ](\\d+)`, 'i'));
  return match ? parseInt(match[1], 10) : 0;
}

export function detectBrowser(userAgent?: string, maxTouchPoints?: number): HelprrBrowser {
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const touch = maxTouchPoints ?? (typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints);
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
  const android = /Android/i.test(ua);
  const edgeChromium = /Edg\//.test(ua);
  const opera = /OPR\/|Opera/.test(ua);
  const chrome = /Chrome\//.test(ua) && !edgeChromium && !opera;
  const firefox = /Firefox\//.test(ua);
  const safari = /Safari\//.test(ua) && !chrome && !edgeChromium && !firefox && !opera && !android;
  const osx = /Mac OS X/.test(ua) && !iOS;
  const windows = /Windows/.test(ua);
  const mobile = iOS || android || /mobi/i.test(ua);

  return {
    chrome,
    edgeChromium,
    firefox,
    safari,
    opera,
    iOS,
    iOSVersion: iOS ? iOSVersion(ua) : 0,
    osx,
    android,
    mobile,
    windows,
    versionMajor: chrome || edgeChromium
      ? versionMajor(ua, 'Chrome') || versionMajor(ua, 'Edg')
      : firefox
        ? versionMajor(ua, 'Firefox')
        : safari
          ? versionMajor(ua, 'Version')
          : versionMajor(ua, 'Chrome'),
  };
}

export function canPlayNativeHls(video: HTMLVideoElement, browser: HelprrBrowser): boolean {
  if (browser.iOS || (browser.safari && browser.osx)) return true;
  return Boolean(
    video.canPlayType('application/x-mpegURL').replace(/no/, '')
    || video.canPlayType('application/vnd.apple.mpegURL').replace(/no/, ''),
  );
}

export function canPlayHlsWithMse(): boolean {
  return typeof window !== 'undefined' && typeof window.MediaSource !== 'undefined';
}

export function canPlayHls(video: HTMLVideoElement, browser: HelprrBrowser): boolean {
  return canPlayNativeHls(video, browser) || canPlayHlsWithMse();
}
