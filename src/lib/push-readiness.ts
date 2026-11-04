/**
 * Every way push can be off on this device, as rows for Settings → Notifications →
 * Check push setup. Pure: the page gathers the facts, this names each one.
 */
export type PushCheckState = 'ok' | 'fail' | 'warn' | 'checking' | 'skip';

export type PushCheckId = 'secure' | 'browser' | 'server' | 'worker' | 'ios-version' | 'installed' | 'permission' | 'subscribed';

export interface PushCheck {
  id: PushCheckId;
  state: PushCheckState;
  title: string;
  /** Why, and how to fix it; only for a row that is not ok. */
  detail?: string;
  /** Where the fix is, when it is a page in Helprr. */
  fixHref?: string;
}

export interface PushFacts {
  /** window.isSecureContext: https, or localhost. */
  secure: boolean;
  origin: string;
  /** The browser has service workers, PushManager and Notification. */
  supported: boolean;
  ios: boolean;
  /** iOS major and minor, when it can be read from the browser. */
  iosVersion: [number, number] | null;
  standalone: boolean;
  /** null while asking the server. */
  serverConfigured: boolean | null;
  /** The server could not be asked (offline, an error, a proxy in the way). */
  serverUnreachable?: boolean;
  /** The server's own words for what is missing (admins only). */
  serverMissing?: string[];
  admin: boolean;
  /** null while checking. */
  workerActive: boolean | null;
  permission: NotificationPermission | null;
  /** null while checking. */
  subscribed: boolean | null;
  /** The push hook's own words for why turning push on failed, if it did. */
  deviceError?: string | null;
}

const INSTALL_PAGE = '/settings/appearance#install';

/** The iOS version from a user agent: "iPhone OS 17_4" on iPhone, "Version/17.4" on an iPad that asks for desktop pages. */
export function parseIosVersion(userAgent: string): [number, number] | null {
  const match = /OS (\d+)_(\d+)/.exec(userAgent) ?? /Version\/(\d+)\.(\d+)/.exec(userAgent);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function pushReadinessChecks(facts: PushFacts): PushCheck[] {
  const checks: PushCheck[] = [];
  // Without a secure address or browser support, the rest cannot be asked.
  const browserReady = facts.secure && facts.supported;

  checks.push(
    facts.secure
      ? { id: 'secure', state: 'ok', title: 'Secure address' }
      : {
          id: 'secure',
          state: 'fail',
          title: 'Not a secure address',
          detail: `You are on ${facts.origin}. Browsers only allow notifications on an https:// address (or localhost). Put Helprr behind HTTPS, for example with Tailscale Serve, Cloudflare Tunnel or a reverse proxy, and open it there.`,
        },
  );

  // A secure page without the push APIs: this browser cannot do push at all. On iPhone
  // and iPad the iOS rows name the cause (not installed yet, or iOS too old or unknown),
  // so the row only stands for an installed app on a recent iOS that still lacks push.
  const [iosMajor, iosMinor] = facts.iosVersion ?? [0, 0];
  const recentIos = facts.iosVersion !== null && (iosMajor > 16 || (iosMajor === 16 && iosMinor >= 4));
  if (facts.secure && !facts.supported && (!facts.ios || (facts.standalone && recentIos))) {
    checks.push({
      id: 'browser',
      state: 'fail',
      title: 'This browser cannot do push',
      detail: facts.ios
        ? 'This iPhone or iPad does not offer push to the installed app. Update iOS, then open Helprr again.'
        : 'Use Chrome, Edge, Firefox or Safari in a normal window (private windows have no push).',
    });
  }

  if (facts.serverUnreachable && facts.serverConfigured === null) {
    checks.push({
      id: 'server',
      state: 'warn',
      title: 'Could not reach Helprr to check its push keys',
      detail: 'Check the connection and reload this page.',
    });
  } else if (facts.serverConfigured === null) {
    checks.push({ id: 'server', state: 'checking', title: 'Server push keys' });
  } else if (facts.serverConfigured) {
    checks.push({ id: 'server', state: 'ok', title: 'Server push keys' });
  } else {
    checks.push({
      id: 'server',
      state: 'fail',
      title: 'This server has no push keys',
      detail: facts.admin
        ? `Helprr is missing ${(facts.serverMissing?.length ? facts.serverMissing : ['its push keys']).join(', ')}. Leave VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT all out of .env (with the current docker-compose.yml Helprr then makes its own keys), or set all three; then run docker compose up -d.`
        : 'Ask your Helprr admin to turn on push notifications for this server.',
    });
  }

  if (facts.ios) {
    const [major, minor] = [iosMajor, iosMinor];
    const known = facts.iosVersion !== null;
    const recent = recentIos;
    checks.push(
      !known
        ? { id: 'ios-version', state: 'warn', title: 'iOS version unknown', detail: 'Push needs iOS 16.4 or later.' }
        : recent
          ? { id: 'ios-version', state: 'ok', title: `iOS ${major}.${minor}` }
          : {
              id: 'ios-version',
              state: 'fail',
              title: `iOS ${major}.${minor} is too old`,
              detail: 'Push needs iOS 16.4 or later. Update in Settings → General → Software Update.',
            },
    );
  }

  if (facts.standalone) {
    checks.push({ id: 'installed', state: 'ok', title: 'Opened as the installed app' });
  } else if (facts.ios) {
    checks.push({
      id: 'installed',
      state: 'fail',
      title: 'Not opened as the installed app',
      detail: 'On iPhone and iPad, notifications only work in the installed app. In Safari, tap Share, then "Add to Home Screen", and open Helprr from the Home Screen.',
      fixHref: INSTALL_PAGE,
    });
  } else {
    // Outside iOS, push reaches the browser with the tab closed; installing is optional.
    checks.push({ id: 'installed', state: 'ok', title: 'Opened in the browser (installing is optional here)' });
  }

  if (!browserReady) {
    checks.push({
      id: 'worker',
      state: 'skip',
      title: 'Service worker',
      detail: !facts.secure
        ? 'Needs a secure address first.'
        : facts.ios && !facts.standalone
          ? 'Needs the installed app first.'
          : 'This browser cannot do push.',
    });
  } else if (facts.workerActive === null) {
    checks.push({ id: 'worker', state: 'checking', title: 'Service worker' });
  } else if (facts.workerActive) {
    checks.push({ id: 'worker', state: 'ok', title: 'Service worker running' });
  } else {
    checks.push({
      id: 'worker',
      state: 'fail',
      title: 'Service worker not running',
      detail: 'Reload the page. If it stays, remove Helprr\'s site data in the browser settings (or delete and add the app again) and sign in again.',
    });
  }

  if (!browserReady || facts.permission === null) {
    checks.push({ id: 'permission', state: 'skip', title: 'Permission to notify' });
  } else if (facts.permission === 'granted') {
    checks.push({ id: 'permission', state: 'ok', title: 'Allowed to notify' });
  } else if (facts.permission === 'denied') {
    checks.push({
      id: 'permission',
      state: 'fail',
      title: 'Notifications are blocked',
      detail: facts.ios
        ? 'Allow them in Settings → Notifications → Helprr on this iPhone or iPad, then come back.'
        : 'Allow notifications for this site in the browser\'s site settings (the icon left of the address), then reload.',
    });
  } else {
    checks.push({
      id: 'permission',
      state: 'warn',
      title: 'Not asked yet',
      detail: 'Turning push on for this device asks for it.',
      fixHref: '/settings/notifications',
    });
  }

  if (!browserReady) {
    checks.push({ id: 'subscribed', state: 'skip', title: 'This device' });
  } else if (facts.workerActive === false && !facts.subscribed) {
    // Push needs the service worker; its own row says what to do.
    checks.push({ id: 'subscribed', state: 'skip', title: 'This device', detail: 'Needs the service worker first.' });
  } else if (facts.subscribed === null) {
    checks.push({ id: 'subscribed', state: 'checking', title: 'This device' });
  } else if (facts.subscribed) {
    checks.push({ id: 'subscribed', state: 'ok', title: 'This device gets push' });
  } else {
    checks.push({
      id: 'subscribed',
      state: 'fail',
      title: 'Push is off on this device',
      detail: `${facts.deviceError ? `${facts.deviceError.trim().replace(/[^.!?]$/, '$&.')} ` : ''}Turn it on with "Enable on this device" in Settings → Notifications.`,
      fixHref: '/settings/notifications',
    });
  }
  return checks;
}
