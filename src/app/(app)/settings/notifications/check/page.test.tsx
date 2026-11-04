// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Settings → Notifications → Check push setup (plan item 3.5): the page gathers the
// browser's facts; src/lib/push-readiness.ts names them.

const mocks = vi.hoisted(() => ({
  push: { isSupported: true, isStandalone: true, isSubscribed: true, loading: false },
  role: 'admin' as 'admin' | 'member',
  serverPush: { publicKey: 'key', configured: true } as { publicKey: string | null; configured?: boolean; missing?: string[] } | undefined,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.serverPush, isError: false }),
}));
vi.mock('@/hooks/use-push-notifications', () => ({ usePushNotifications: () => mocks.push }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => ({ role: mocks.role }) }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

import PushCheckPage from './page';

const define = (target: object, key: string, value: unknown) => Object.defineProperty(target, key, { value, configurable: true });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64)';

function browser({ secure = true, ua = DESKTOP, permission = 'granted', worker = true }: { secure?: boolean; ua?: string; permission?: NotificationPermission; worker?: boolean } = {}) {
  define(window, 'isSecureContext', secure);
  define(navigator, 'userAgent', ua);
  define(window, 'Notification', { permission });
  define(navigator, 'serviceWorker', { getRegistration: async () => (worker ? { active: {} } : undefined) });
}

const row = (title: string | RegExp) => screen.getByText(title).closest('li')!;

beforeEach(() => {
  mocks.push = { isSupported: true, isStandalone: true, isSubscribed: true, loading: false };
  mocks.role = 'admin';
  mocks.serverPush = { publicKey: 'key', configured: true };
  browser();
});
afterEach(() => browser());

describe('Check push setup', () => {
  it('says push can reach a ready device, and offers a test', async () => {
    render(<PushCheckPage />);
    await waitFor(() => expect(screen.getByText('Push can reach this device.')).toBeTruthy());
    expect(screen.getByText('Service worker running')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send a test notification/ })).toBeTruthy();
  });

  it('names every problem on an iPhone in Safari over plain HTTP', async () => {
    browser({ secure: false, ua: IPHONE, permission: 'default' });
    mocks.push = { isSupported: false, isStandalone: false, isSubscribed: false, loading: false };
    render(<PushCheckPage />);
    await waitFor(() => expect(screen.getByText(/2 things stop push on this device/)).toBeTruthy());
    expect(row('Not a secure address').textContent).toContain('Needs fixing');
    expect(row('Not opened as the installed app').querySelector('a')?.getAttribute('href')).toBe('/settings/appearance#install');
    expect(screen.getByText('iOS 17.4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send a test notification/ })).toBeNull();
  });

  it('names a stopped service worker, blocked notifications and a server without keys', async () => {
    browser({ worker: false, permission: 'denied' });
    mocks.serverPush = { publicKey: null, configured: false, missing: ['VAPID_PRIVATE_KEY'] };
    mocks.push = { isSupported: true, isStandalone: false, isSubscribed: false, loading: false };
    render(<PushCheckPage />);
    await waitFor(() => expect(screen.getByText('Service worker not running')).toBeTruthy());
    expect(screen.getByText('Notifications are blocked')).toBeTruthy();
    expect(screen.getByText(/missing VAPID_PRIVATE_KEY/)).toBeTruthy();
    expect(screen.getByText(/4 things stop push on this device/)).toBeTruthy();
  });

  it('tells a member to ask the admin about the server', async () => {
    mocks.role = 'member';
    mocks.serverPush = { publicKey: null, configured: false };
    render(<PushCheckPage />);
    await waitFor(() => expect(screen.getByText('Ask your Helprr admin to turn on push notifications for this server.')).toBeTruthy());
  });
});
