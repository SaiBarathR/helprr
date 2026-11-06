// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ permissions: { template: 'member', effective: { 'movies.add': false } as Record<string, boolean> } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import UsersAdminPage from './page';

const member = {
  id: 'u2', username: 'iso', displayName: 'Iso', role: 'member', status: 'active', template: 'member',
  jellyfinUserId: null, seerrUserId: null, createdAt: '2026-10-01T00:00:00.000Z', lastLoginAt: null,
};

beforeEach(() => {
  mocks.permissions = { template: 'member', effective: { 'movies.add': false } };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/users') return new Response(JSON.stringify([member]));
    if (url === '/api/users/u2/permissions') return new Response(JSON.stringify(mocks.permissions));
    return new Response(JSON.stringify([]));
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('editing a user', () => {
  it("shows the server's permissions, and follows them when they change on the server (a role change realigns them)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><UsersAdminPage /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));

    const toggle = await screen.findByRole('switch', { name: 'Add movies to library' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    mocks.permissions = { template: 'admin', effective: { 'movies.add': true } };
    await client.invalidateQueries({ queryKey: ['users', 'permissions', 'u2'] });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Add movies to library' }).getAttribute('aria-checked')).toBe('true'));
  });
});

describe('invite and reset links', () => {
  const TOKEN = 'c'.repeat(43);
  const expiresAt = '2026-11-14T12:00:00.000Z';

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><UsersAdminPage /></QueryClientProvider>);
  }

  it('creates an invited user and shows the link once', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url === '/api/users' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          ...member, id: 'u3', username: 'newbie', status: 'pending', hasPassword: false,
          passwordLink: { purpose: 'invite', expiresAt }, linkToken: TOKEN,
        }), { status: 201 });
      }
      if (url === '/api/users') return new Response(JSON.stringify([member]));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await userEvent.type(screen.getByLabelText('Username'), 'newbie');
    await userEvent.type(screen.getByLabelText('Display name'), 'New');
    // Invite is the default, so there is no password to invent.
    expect(screen.queryByLabelText('Password')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Create and get link' }));

    const field = await screen.findByLabelText('Invite link for @newbie');
    expect((field as HTMLInputElement).value).toBe(`${window.location.origin}/invite/${TOKEN}`);
    const sent = calls.find((c) => c.url === '/api/users' && c.body)?.body;
    expect(sent).toMatchObject({ invite: true });
    expect(sent).not.toHaveProperty('password');
  });

  it('makes and revokes a reset link for an active local user', async () => {
    const local = { ...member, hasPassword: true, passwordLink: null };
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/users/u2/password-link') {
        methods.push(init?.method ?? 'GET');
        return init?.method === 'POST'
          ? new Response(JSON.stringify({ token: TOKEN, purpose: 'reset', expiresAt }), { status: 201 })
          : new Response(JSON.stringify({ revoked: true }));
      }
      if (url === '/api/users') return new Response(JSON.stringify([local]));
      if (url === '/api/users/u2/permissions') return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Make link' }));

    expect(((await screen.findByLabelText('Password reset link for @iso')) as HTMLInputElement).value).toContain(TOKEN);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.queryByLabelText('Password reset link for @iso')).toBeNull());
    expect(methods).toEqual(['POST', 'DELETE']);
  });
});
