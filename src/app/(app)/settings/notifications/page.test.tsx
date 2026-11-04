// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Each state of the push section names its real cause (plan item 1.4).

const mocks = vi.hoisted(() => ({
  push: { isSupported: true, isStandalone: false, isSubscribed: false },
  role: 'admin' as 'admin' | 'member',
  serverPush: undefined as undefined | { publicKey: string | null; configured?: boolean; missing?: string[] },
  queryEnabled: [] as boolean[],
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: unknown[]; enabled?: boolean }) => {
    if (JSON.stringify(options.queryKey) === '["push","public-key"]') {
      mocks.queryEnabled.push(options.enabled !== false);
      return { data: options.enabled === false ? undefined : mocks.serverPush };
    }
    return { data: undefined };
  },
  useQueryClient: () => ({}),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/use-push-notifications', () => ({
  usePushNotifications: () => ({
    ...mocks.push,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    loading: false,
    error: null,
    subscriptionEndpoint: null,
  }),
}));
vi.mock('@/components/permission-provider', () => ({ useMe: () => ({ role: mocks.role }) }));
vi.mock('@/lib/hooks/use-app-settings', () => ({ useAppSettings: () => ({ settings: null, loading: false, update: vi.fn() }) }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock('@/components/notifications/event-type-prefs', () => ({ EventTypePrefs: () => null }));
vi.mock('@/components/notifications/quiet-hours-section', () => ({ QuietHoursSection: () => null }));
vi.mock('@/components/settings/disk-low-space-alerts', () => ({ DiskLowSpaceAlerts: () => null }));

import NotificationsSettingsPage from './page';

const secureContext = (value: boolean) => Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
const userAgent = (value: string) => Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64)';
const enableButton = () => screen.queryByRole('button', { name: /Enable on this device/ });

beforeEach(() => {
  mocks.push = { isSupported: true, isStandalone: false, isSubscribed: false };
  mocks.role = 'admin';
  mocks.serverPush = { publicKey: 'key', configured: true };
  mocks.queryEnabled = [];
  secureContext(true);
  userAgent(DESKTOP);
});

afterEach(() => {
  secureContext(true);
  userAgent(DESKTOP);
});

describe('the push section', () => {
  it('blames plain HTTP, shows the address, and asks the server nothing', () => {
    secureContext(false);
    mocks.push.isSupported = false;
    render(<NotificationsSettingsPage />);
    expect(screen.getByText('Push needs HTTPS')).toBeDefined();
    expect(document.body.textContent).toContain(`You are on ${window.location.origin}.`);
    expect(document.body.textContent).not.toContain('not supported');
    expect(enableButton()).toBeNull();
    expect(mocks.queryEnabled.every((enabled) => !enabled)).toBe(true);
  });

  it('asks iPhone Safari to add Helprr to the Home Screen first', () => {
    userAgent(IPHONE);
    mocks.push.isSupported = false;
    render(<NotificationsSettingsPage />);
    expect(screen.getByText('Add Helprr to your Home Screen first')).toBeDefined();
    expect(enableButton()).toBeNull();
  });

  it('tells an admin which push variables are missing, and hides Enable', () => {
    mocks.serverPush = { publicKey: 'key', configured: false, missing: ['VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] };
    render(<NotificationsSettingsPage />);
    expect(screen.getByText('Push is not set up on this server')).toBeDefined();
    expect(document.body.textContent).toContain('Helprr is missing VAPID_PRIVATE_KEY, VAPID_SUBJECT.');
    expect(enableButton()).toBeNull();
    expect(screen.queryByText('Install Helprr as a PWA for best results')).toBeNull();
  });

  it('tells a member to ask the admin', () => {
    mocks.role = 'member';
    mocks.serverPush = { publicKey: null, configured: false };
    render(<NotificationsSettingsPage />);
    expect(screen.getByText('Ask your Helprr admin to turn on push notifications for this server.')).toBeDefined();
    expect(document.body.textContent).not.toContain('VAPID');
    expect(enableButton()).toBeNull();
  });

  it('reads an older server without the configured field from its public key', () => {
    mocks.serverPush = { publicKey: null };
    render(<NotificationsSettingsPage />);
    expect(screen.getByText('Push is not set up on this server')).toBeDefined();
  });

  it('shows the normal Enable button when everything is ready', () => {
    render(<NotificationsSettingsPage />);
    expect(enableButton()).not.toBeNull();
    expect(screen.queryByText('Push needs HTTPS')).toBeNull();
    expect(screen.queryByText('Push is not set up on this server')).toBeNull();
    expect(mocks.queryEnabled.some(Boolean)).toBe(true);
  });

  it('keeps "not supported" for a secure browser without push', () => {
    mocks.push.isSupported = false;
    render(<NotificationsSettingsPage />);
    expect(screen.getByText('Push notifications are not supported in this browser.')).toBeDefined();
  });
});
