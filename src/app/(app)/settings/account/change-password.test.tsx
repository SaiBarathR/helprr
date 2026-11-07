// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MePayload } from '@/components/permission-provider';

const mocks = vi.hoisted(() => ({ me: null as MePayload | null }));

vi.mock('@/components/permission-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/permission-provider')>()),
  useMe: () => mocks.me,
}));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/settings/jellyfin-connection', () => ({ JellyfinConnection: () => null }));
vi.mock('@/components/settings/two-factor-section', () => ({ TwoFactorSection: () => null }));
vi.mock('@/lib/client-cache', () => ({ endSessionInThisBrowser: vi.fn(), requestSessionLogout: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Drawer: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div>{children}</div> : null),
    DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass, DrawerDescription: Pass, DrawerFooter: Pass, DrawerClose: Pass,
  };
});

import AccountSettingsPage from './page';

function me(overrides: Partial<MePayload>): MePayload {
  return {
    id: 'user-1', name: 'Alex', username: 'alex', role: 'member', template: 'member',
    capabilities: {}, hasLocalPassword: true,
    ...overrides,
  } as MePayload;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><AccountSettingsPage /></QueryClientProvider>);
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function fillForm(current: string, next: string, confirm = next) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  await user.type(screen.getByLabelText('Current password'), current);
  await user.type(screen.getByLabelText('New password'), next);
  await user.type(screen.getByLabelText('Confirm new password'), confirm);
  return user;
}

describe('Account settings', () => {
  it.each(['member', 'admin'] as const)('shows who is signed in for a %s', (role) => {
    mocks.me = me({ role, name: 'Alex Doe', username: 'alex' });
    renderPage();
    expect(screen.getByText('Alex Doe')).toBeTruthy();
    expect(screen.getByText('@alex')).toBeTruthy();
    expect(screen.getByText(role)).toBeTruthy();
  });

  it('offers no password change to a Jellyfin-only account', () => {
    mocks.me = me({ hasLocalPassword: false });
    renderPage();
    expect(screen.queryByRole('button', { name: 'Change password' })).toBeNull();
  });

  it('keeps Change password disabled until the new password is long enough and confirmed', async () => {
    mocks.me = me({});
    renderPage();
    const user = await fillForm('the words typed at sign in', 'too short');
    expect(screen.getByText(/at least 15 characters/).className).toContain('text-destructive');
    const submit = screen.getAllByRole('button', { name: 'Change password' }).at(-1)!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'a different long passphrase');
    expect(screen.getByText('Passwords don’t match')).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a wrong current password next to that field', async () => {
    mocks.me = me({});
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Current password is incorrect' }), { status: 403 }));
    renderPage();
    const user = await fillForm('not the right words', 'a different long passphrase');
    await user.click(screen.getAllByRole('button', { name: 'Change password' }).at(-1)!);

    expect(await screen.findByText('Current password is incorrect')).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/me/password');
    expect(JSON.parse(init.body)).toEqual({
      currentPassword: 'not the right words',
      newPassword: 'a different long passphrase',
    });
  });

  it('shows the throttle message when rate limited', async () => {
    mocks.me = me({});
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Too many login attempts. Try again in 1 minute.' }), { status: 429 }),
    );
    renderPage();
    const user = await fillForm('the words typed at sign in', 'a different long passphrase');
    await user.click(screen.getAllByRole('button', { name: 'Change password' }).at(-1)!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Too many login attempts/);
  });

  it('closes the drawer after a successful change', async () => {
    mocks.me = me({});
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ revokedSessions: 2 }), { status: 200 }));
    renderPage();
    const user = await fillForm('the words typed at sign in', 'a different long passphrase');
    await user.click(screen.getAllByRole('button', { name: 'Change password' }).at(-1)!);
    await waitFor(() => expect(screen.queryByLabelText('Current password')).toBeNull());
  });
});
