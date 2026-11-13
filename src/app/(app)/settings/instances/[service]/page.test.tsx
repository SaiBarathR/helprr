// @vitest-environment jsdom
import { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Adding Jellyfin or changing its address or key asks an admin for their
// password (and code), and tells a member it is for an admin. So is its
// external URL, which a member sees read-only.

const mocks = vi.hoisted(() => ({ me: { role: 'admin' } as { role: string } }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => mocks.me }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ notFound: vi.fn(), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import ServiceDetailPage from './page';

const saved = { id: 'jf-1', type: 'JELLYFIN', label: 'Jellyfin', isDefault: true, url: 'http://jellyfin.lan:8096', apiKey: 'abcd****wxyz', username: 'jf-admin' };
// Already settled, as React marks a promise it has read, so `use` does not suspend.
const params = Object.assign(Promise.resolve({ service: 'jellyfin' }), { status: 'fulfilled', value: { service: 'jellyfin' } });
let sent: Array<Record<string, unknown>>;
let twoStep: boolean;

beforeEach(() => {
  sent = [];
  twoStep = true;
  mocks.me = { role: 'admin' };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/services' && init?.method === 'POST') {
      sent.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify(saved));
    }
    if (url === '/api/services') return new Response(JSON.stringify([saved]));
    if (url === '/api/services/test') {
      return new Response(JSON.stringify({ success: true, userId: 'jf-admin', users: [{ Id: 'jf-admin', Name: 'admin' }] }));
    }
    if (url === '/api/me/totp') return new Response(JSON.stringify({ available: true, enabled: twoStep, recoveryCodesLeft: 8 }));
    if (url === '/api/jellyfin/users') return new Response(JSON.stringify({ users: [{ Id: 'jf-admin', Name: 'admin' }] }));
    return new Response(JSON.stringify([]));
  }));
});

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>
        <ServiceDetailPage params={params} />
      </Suspense>
    </QueryClientProvider>,
  );
  await waitFor(() => expect((screen.getByLabelText('URL') as HTMLInputElement).value).toBe(saved.url));
}

async function moveTo(url: string) {
  const field = screen.getByLabelText('URL');
  await userEvent.clear(field);
  await userEvent.type(field, url);
  const key = document.getElementById('conn-apiKey') as HTMLInputElement;
  await userEvent.clear(key);
  await userEvent.type(key, 'a-new-api-key');
  await userEvent.click(screen.getByRole('button', { name: 'Test' }));
}

describe('the Jellyfin connection', () => {
  it('asks an admin for nothing while the address and key stay', async () => {
    await renderPage();
    expect(screen.queryByLabelText('Your current password')).toBeNull();
  });

  it('asks an admin for their password and code for a new address, says it signs linked accounts out, and sends them', async () => {
    await renderPage();
    await moveTo('http://new.lan:8096');
    await screen.findByText(/signs out every account linked to a Jellyfin user/);
    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(screen.getByLabelText('Authenticator or recovery code')).toBeTruthy());
    expect(save.hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('Your current password'), 'my password');
    await userEvent.type(screen.getByLabelText('Authenticator or recovery code'), '123456');
    await userEvent.click(save);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: 'http://new.lan:8096', currentPassword: 'my password', code: '123456' });
  });

  it('shows a member the address and key read-only, saying it is for an admin', async () => {
    mocks.me = { role: 'member' };
    await renderPage();
    // Up front, not only after they try to change something.
    await screen.findByText('Only an admin can add Jellyfin or change its address, API key or default user.');
    expect((screen.getByLabelText('URL') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect((document.getElementById('conn-apiKey') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByText('Admin API key validated — ready to save')).toBeNull();
    expect(screen.queryByLabelText('Your current password')).toBeNull();
  });
});

describe("Jellyfin's external URL", () => {
  const field = () => screen.getByPlaceholderText('https://jellyfin.example.com') as HTMLInputElement;

  it('an admin can edit and save it', async () => {
    await renderPage();
    expect(field().readOnly).toBe(false);
    expect(screen.getByRole('button', { name: 'Save external URL' })).toBeTruthy();
  });

  it('is read-only for a member, with the reason and no Save button', async () => {
    mocks.me = { role: 'member' };
    await renderPage();
    expect(field().readOnly).toBe(true);
    expect(field().getAttribute('aria-describedby')).toBe('external-url-locked');
    expect(screen.getByText("Only an admin can set Jellyfin's external URL.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save external URL' })).toBeNull();
  });
});
