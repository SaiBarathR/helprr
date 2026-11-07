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
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    renderPage();
    const { user, submit } = await openDelete();
    expect(submit.disabled).toBe(true);
    await user.type(screen.getByLabelText('Current password'), 'the words typed at sign in');
    await user.click(submit);

    await waitFor(() => expect(mocks.endSession).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/me');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ currentPassword: 'the words typed at sign in' });
  });

  it('shows a refusal and stays signed in', async () => {
    mocks.me = me({ role: 'admin' });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'You are the last active admin. Make someone else an admin first.' }), { status: 409 }),
    );
    renderPage();
    const { user, submit } = await openDelete();
    await user.type(screen.getByLabelText('Current password'), 'the words typed at sign in');
    await user.click(submit);

    expect((await screen.findByRole('alert')).textContent).toMatch(/last active admin/);
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('asks a Jellyfin-only account to type its username', async () => {
    mocks.me = me({ hasLocalPassword: false });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    renderPage();
    const { user, submit } = await openDelete();
    const input = screen.getByLabelText('Type alex to confirm');
    await user.type(input, 'ale');
    expect(submit.disabled).toBe(true);
    await user.type(input, 'x');
    await user.click(submit);

    await waitFor(() => expect(mocks.endSession).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ confirmUsername: 'alex' });
  });
});
