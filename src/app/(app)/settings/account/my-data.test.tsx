// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MePayload } from '@/components/permission-provider';

const mocks = vi.hoisted(() => ({
  me: null as MePayload | null,
  endSession: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/components/permission-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/permission-provider')>()),
  useMe: () => mocks.me,
}));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/settings/jellyfin-connection', () => ({ JellyfinConnection: () => null }));
vi.mock('@/components/settings/two-factor-section', () => ({ TwoFactorSection: () => null }));
vi.mock('@/lib/client-cache', () => ({ endSessionInThisBrowser: mocks.endSession, requestSessionLogout: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Drawer: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div>{children}</div> : null),
    DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass, DrawerDescription: Pass, DrawerFooter: Pass, DrawerClose: Pass,
  };
});

import AccountSettingsPage from './page';

function me(overrides: Partial<MePayload> = {}): MePayload {
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
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

// The drawer reads the two-step status, then sends the DELETE.
function serve(deleteResponse: () => Response, twoStep = false) {
  fetchMock.mockImplementation(async (url: string) => (
    url === '/api/me/totp'
      ? new Response(JSON.stringify({ available: true, enabled: twoStep, recoveryCodesLeft: twoStep ? 10 : 0 }), { status: 200 })
      : deleteResponse()
  ));
}
const deleteCall = () => fetchMock.mock.calls.find(([url, init]) => url === '/api/me' && init?.method === 'DELETE')!;

async function openDelete() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Delete my account' }));
  const submit = screen.getAllByRole('button', { name: 'Delete my account' }).at(-1) as HTMLButtonElement;
  return { user, submit };
}

describe('Account: your data', () => {
  it('downloads the export as a file', async () => {
    mocks.me = me();
    fetchMock.mockResolvedValue(new Response('{"kind":"helprr-my-data"}', { status: 200 }));
    const createObjectURL = vi.fn(() => 'blob:my-data');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Download my data' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/me/export');
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(/^helprr-my-data-\d{4}-\d{2}-\d{2}\.json$/);
    // Revoked a moment later, not in the same tick: WebKit can drop the download otherwise.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:my-data'), { timeout: 2000 });
    click.mockRestore();
  });

  it('reports a failed download', async () => {
    mocks.me = me();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Failed to build your data export' }), { status: 500 }));
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download my data' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Failed to build your data export'));
  });

  it('deletes with the current password and signs out', async () => {
    mocks.me = me();
    serve(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    renderPage();
    const { user, submit } = await openDelete();
    expect(submit.disabled).toBe(true);
    await user.type(screen.getByLabelText('Current password'), 'the words typed at sign in');
    // Two-step is off: no code is asked for.
    expect(screen.queryByLabelText('Code from your app, or a recovery code')).toBeNull();
    await user.click(submit);

    await waitFor(() => expect(mocks.endSession).toHaveBeenCalledOnce());
    expect(JSON.parse(deleteCall()[1].body)).toEqual({ currentPassword: 'the words typed at sign in' });
  });

  it('with two-step on, also asks for a code and sends it', async () => {
    mocks.me = me();
    serve(() => new Response(JSON.stringify({ ok: true }), { status: 200 }), true);
    renderPage();
    const { user, submit } = await openDelete();
    const code = await screen.findByLabelText('Code from your app, or a recovery code');
    await user.type(screen.getByLabelText('Current password'), 'the words typed at sign in');
    // The password alone is not enough.
    expect(submit.disabled).toBe(true);
    await user.type(code, ' 123456 ');
    expect(submit.disabled).toBe(false);
    await user.click(submit);

    await waitFor(() => expect(mocks.endSession).toHaveBeenCalledOnce());
    expect(JSON.parse(deleteCall()[1].body)).toEqual({ currentPassword: 'the words typed at sign in', code: '123456' });
  });

  it('shows a wrong code, clears it and stays signed in', async () => {
    mocks.me = me();
    serve(() => new Response(JSON.stringify({ error: 'That code didn’t work. Try again.', field: 'code' }), { status: 403 }), true);
    renderPage();
    const { user, submit } = await openDelete();
    const code = await screen.findByLabelText('Code from your app, or a recovery code') as HTMLInputElement;
    await user.type(screen.getByLabelText('Current password'), 'the words typed at sign in');
    await user.type(code, '000000');
    await user.click(submit);

    expect((await screen.findByRole('alert')).textContent).toMatch(/code didn’t work/);
    expect(code.value).toBe('');
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('marks only the code as wrong after a wrong code', async () => {
    mocks.me = me();
    serve(() => new Response(JSON.stringify({ error: 'That code didn’t work. Try again.', field: 'code' }), { status: 403 }), true);
    renderPage();
    const { user, submit } = await openDelete();
    const code = await screen.findByLabelText('Code from your app, or a recovery code');
    const password = screen.getByLabelText('Current password');
    await user.type(password, 'the words typed at sign in');
    await user.type(code, '000000');
    await user.click(submit);

    await screen.findByRole('alert');
    expect(code.getAttribute('aria-invalid')).toBe('true');
    expect(password.hasAttribute('aria-invalid')).toBe(false);
  });

  it('marks only the password as wrong after a wrong password, and clears it on typing', async () => {
    mocks.me = me();
    serve(() => new Response(JSON.stringify({ error: 'Current password is incorrect', field: 'currentPassword' }), { status: 403 }), true);
    renderPage();
    const { user, submit } = await openDelete();
    const code = await screen.findByLabelText('Code from your app, or a recovery code');
    const password = screen.getByLabelText('Current password');
    await user.type(password, 'not the right words');
    await user.type(code, '123456');
    await user.click(submit);

    expect((await screen.findByRole('alert')).textContent).toMatch(/password is incorrect/);
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(code.hasAttribute('aria-invalid')).toBe(false);
    await user.type(password, 'x');
    expect(password.hasAttribute('aria-invalid')).toBe(false);
  });

  it('marks neither field for a refusal that is about neither', async () => {
    mocks.me = me({ role: 'admin' });
    serve(() => new Response(
      JSON.stringify({ error: 'You are the last active admin. Make someone else an admin first.' }), { status: 409 },
    ));
    renderPage();
    const { user, submit } = await openDelete();
    const password = screen.getByLabelText('Current password');
    await user.type(password, 'the words typed at sign in');
    await user.click(submit);

    await screen.findByRole('alert');
    expect(password.hasAttribute('aria-invalid')).toBe(false);
  });

  it('asks for the code when the server says two-step is on after all', async () => {
    mocks.me = me();
    serve(() => new Response(
      JSON.stringify({ error: 'Enter a code from your authenticator app or a recovery code', field: 'code', needsCode: true }),
      { status: 400 },
    ));
    renderPage();
    const { user, submit } = await openDelete();
    await user.type(screen.getByLabelText('Current password'), 'the words typed at sign in');
    await user.click(submit);

    expect(await screen.findByLabelText('Code from your app, or a recovery code')).toBeTruthy();
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('shows a refusal and stays signed in', async () => {
    mocks.me = me({ role: 'admin' });
    serve(() => new Response(
      JSON.stringify({ error: 'You are the last active admin. Make someone else an admin first.' }), { status: 409 },
    ));
    renderPage();
    const { user, submit } = await openDelete();
    await user.type(screen.getByLabelText('Current password'), 'the words typed at sign in');
    await user.click(submit);

    expect((await screen.findByRole('alert')).textContent).toMatch(/last active admin/);
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('asks a Jellyfin-only account for its Jellyfin password', async () => {
    mocks.me = me({ hasLocalPassword: false });
    serve(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    renderPage();
    const { user, submit } = await openDelete();
    const input = screen.getByLabelText('Jellyfin password') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(submit.disabled).toBe(true);
    await user.type(input, 'the words typed at sign in');
    await user.click(submit);

    await waitFor(() => expect(mocks.endSession).toHaveBeenCalledOnce());
    expect(JSON.parse(deleteCall()[1].body)).toEqual({ currentPassword: 'the words typed at sign in' });
  });
});
