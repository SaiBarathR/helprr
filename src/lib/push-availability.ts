/**
 * Why push cannot be turned on in this browser, or null when it can.
 *
 * Browsers hide the push APIs on a page that is not a secure context, so a
 * plain-HTTP LAN address looked exactly like a browser without push. iPhone
 * Safari also hides them until Helprr is added to the Home Screen.
 */
export type PushUnavailableReason = 'insecure' | 'ios-not-installed' | 'unsupported';

export function pushUnavailableReason(env: {
  secure: boolean;
  supported: boolean;
  ios: boolean;
  standalone: boolean;
}): PushUnavailableReason | null {
  if (!env.secure) return 'insecure';
  if (env.supported) return null;
  if (env.ios && !env.standalone) return 'ios-not-installed';
  return 'unsupported';
}

/** iPhone, iPod, or an iPad (which reports itself as a Mac with touch). */
export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}
