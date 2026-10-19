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
