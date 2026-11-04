/**
 * Every way push can be off on this device, as rows for Settings → Notifications →
 * Check push setup. Pure: the page gathers the facts, this names each one.
 */
export type PushCheckState = 'ok' | 'fail' | 'warn' | 'checking' | 'skip';

export type PushCheckId = 'secure' | 'server' | 'worker' | 'ios-version' | 'installed' | 'permission' | 'subscribed';

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
  /** The server's own words for what is missing (admins only). */
  serverMissing?: string[];
  admin: boolean;
  /** null while checking. */
  workerActive: boolean | null;
  permission: NotificationPermission | null;
  /** null while checking. */
  subscribed: boolean | null;
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

  if (facts.serverConfigured === null) {
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
    const [major, minor] = facts.iosVersion ?? [0, 0];
    const known = facts.iosVersion !== null;
    const recent = major > 16 || (major === 16 && minor >= 4);
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
      detail: 'On iPhone and iPad, notifications only work in the installed app. Tap Share, then "Add to Home Screen", and open Helprr from the Home Screen.',
      fixHref: INSTALL_PAGE,
    });
  } else {
    checks.push({
      id: 'installed',
      state: 'warn',
      title: 'Open in the browser',
      detail: 'Push works here too. Installing Helprr as an app keeps notifications coming when the tab is closed.',
      fixHref: INSTALL_PAGE,
    });
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
  } else if (facts.subscribed === null) {
    checks.push({ id: 'subscribed', state: 'checking', title: 'This device' });
  } else if (facts.subscribed) {
    checks.push({ id: 'subscribed', state: 'ok', title: 'This device gets push' });
  } else {
    checks.push({
      id: 'subscribed',
      state: 'fail',
      title: 'Push is off on this device',
      detail: 'Turn it on with "Enable on this device" in Settings → Notifications.',
      fixHref: '/settings/notifications',
    });
  }
  return checks;
}
