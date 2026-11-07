// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissions: { template: 'member', effective: { 'movies.add': false } as Record<string, boolean> },
  me: null as { id: string } | null,
}));
vi.mock('@/components/permission-provider', () => ({ useMe: () => mocks.me }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import UsersAdminPage from './page';

// Radix Select needs these, which jsdom lacks.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

const member = {
  id: 'u2', username: 'iso', displayName: 'Iso', role: 'member', status: 'active', template: 'member',
  jellyfinUserId: null, seerrUserId: null, createdAt: '2026-10-01T00:00:00.000Z', lastLoginAt: null,
};

beforeEach(() => {
  mocks.permissions = { template: 'member', effective: { 'movies.add': false } };
  mocks.me = null;
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

  it('warns when the user can request but not browse Discover', async () => {
    mocks.permissions = { template: 'member', effective: { 'requests.create': true, 'discover.view': false } };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><UsersAdminPage /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    expect(await screen.findByText(/Can request, but can.t browse Discover/)).toBeTruthy();

    mocks.permissions = { template: 'member', effective: { 'requests.create': true, 'discover.view': true } };
    await client.invalidateQueries({ queryKey: ['users', 'permissions', 'u2'] });
    await waitFor(() => expect(screen.queryByText(/Can request, but can.t browse Discover/)).toBeNull());
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
    expect((field as HTMLInputElement).value).toBe(`${window.location.origin}/invite#${TOKEN}`);
    const sent = calls.find((c) => c.url === '/api/users' && c.body)?.body;
    expect(sent).toMatchObject({ invite: true });
    expect(sent).not.toHaveProperty('password');
  });

  it('builds the invite link on APP_ORIGIN when the server sends one', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/users' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          ...member, id: 'u3', username: 'newbie', status: 'pending', hasPassword: false,
          passwordLink: { purpose: 'invite', expiresAt }, linkToken: TOKEN, linkOrigin: 'https://helprr.example.com',
        }), { status: 201 });
      }
      if (url === '/api/users') return new Response(JSON.stringify([member]));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await userEvent.type(screen.getByLabelText('Username'), 'newbie');
    await userEvent.type(screen.getByLabelText('Display name'), 'New');
    await userEvent.click(screen.getByRole('button', { name: 'Create and get link' }));
    const field = await screen.findByLabelText('Invite link for @newbie');
    expect((field as HTMLInputElement).value).toBe(`https://helprr.example.com/invite#${TOKEN}`);
  });

  it('turns the invite link off when a Jellyfin account is picked', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url === '/api/jellyfin/users') return new Response(JSON.stringify({ users: [{ Id: 'jf-7', Name: 'Jelly Seven' }] }));
      if (url === '/api/users' && init?.method === 'POST') {
        return new Response(JSON.stringify({ ...member, id: 'u3', username: 'jelly', passwordLink: null }), { status: 201 });
      }
      if (url === '/api/users') return new Response(JSON.stringify([member]));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await userEvent.type(screen.getByLabelText('Username'), 'jelly');
    await userEvent.type(screen.getByLabelText('Display name'), 'Jelly');
    expect(screen.getByRole('switch', { name: 'Invite link' }).getAttribute('aria-checked')).toBe('true');

    // Role, Jellyfin account, Seerr account.
    await userEvent.click(screen.getAllByRole('combobox')[1]);
    await userEvent.click(await screen.findByRole('option', { name: 'Jelly Seven' }));
    expect(screen.getByRole('switch', { name: 'Invite link' }).getAttribute('aria-checked')).toBe('false');

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/users' && c.body)).toBe(true));
    expect(calls.find((c) => c.url === '/api/users' && c.body)?.body).toMatchObject({ invite: false, jellyfinUserId: 'jf-7' });
  });

  it('makes and revokes a reset link for an active local user', async () => {
    const local = { ...member, hasPassword: true, passwordLink: null };
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/users/u2/password-link') {
        methods.push(init?.method ?? 'GET');
        return init?.method === 'POST'
          ? new Response(JSON.stringify({ token: TOKEN, purpose: 'reset', expiresAt, origin: 'https://helprr.example.com' }), { status: 201 })
          : new Response(JSON.stringify({ revoked: true }));
      }
      if (url === '/api/users') return new Response(JSON.stringify([local]));
      if (url === '/api/users/u2/permissions') return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Make link' }));

    expect(((await screen.findByLabelText('Password reset link for @iso')) as HTMLInputElement).value)
      .toBe(`https://helprr.example.com/invite#${TOKEN}`);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.queryByLabelText('Password reset link for @iso')).toBeNull());
    expect(methods).toEqual(['POST', 'DELETE']);
  });
});

describe('two-step sign-in', () => {
  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><UsersAdminPage /></QueryClientProvider>);
  }

  it('shows it in the list, and turns it off for a member after a confirm', async () => {
    let on = true;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/users/u2/totp') {
        calls.push(init?.method ?? 'GET');
        on = false;
        return new Response(JSON.stringify({ ok: true, revokedSessions: 2 }));
      }
      if (url === '/api/users') return new Response(JSON.stringify([{ ...member, hasPassword: true, passwordLink: null, twoStepEnabled: on }]));
      if (url === '/api/users/u2/permissions') return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    expect(await screen.findByText(/two-step on/)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: /Iso/ }));

    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm.textContent).toContain('Turn off two-step sign-in for Iso?');
    expect(calls).toEqual([]);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Turn off' }));

    await waitFor(() => expect(calls).toEqual(['DELETE']));
    await waitFor(() => expect(screen.queryByText(/two-step on/)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
  });

  it('says two-step off for an account with a Helprr password, and nothing for a Jellyfin-only one', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/users') {
        return new Response(JSON.stringify([
          { ...member, hasPassword: true, passwordLink: null, twoStepEnabled: false },
          { ...member, id: 'u3', username: 'jelly', displayName: 'Jelly', hasPassword: false, hasJellyfinLink: true, passwordLink: null, twoStepEnabled: false },
        ]));
      }
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    const local = await screen.findByRole('button', { name: /Iso/ });
    expect(local.textContent).toContain('two-step off');
    const jellyfinOnly = screen.getByRole('button', { name: /Jelly @jelly/ });
    expect(jellyfinOnly.textContent).not.toContain('two-step');
  });

  it("says your own reset link turns your two-step sign-in off too", async () => {
    mocks.me = { id: 'u2' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/users') return new Response(JSON.stringify([{ ...member, hasPassword: true, passwordLink: null, twoStepEnabled: true }]));
      if (url === '/api/users/u2/permissions') return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    expect(await screen.findByText(/signs them out everywhere and turns off two-step sign-in/)).toBeDefined();
  });

  it('asks for your password and a code before making your own reset link while your two-step sign-in is on', async () => {
    mocks.me = { id: 'u2' };
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/users/u2/password-link' && init?.method === 'POST') {
        sent.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ token: 'c'.repeat(43), purpose: 'reset', expiresAt: '2026-11-08T12:00:00.000Z' }), { status: 201 });
      }
      if (url === '/api/users') return new Response(JSON.stringify([{ ...member, hasPassword: true, passwordLink: null, twoStepEnabled: true }]));
      if (url === '/api/users/u2/permissions') return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    const make = await screen.findByRole('button', { name: 'Make link' });
    expect(make.hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('Your current password'), 'my password');
    await userEvent.type(screen.getByLabelText('Authenticator or recovery code'), '123456');
    await userEvent.click(make);
    await screen.findByLabelText('Password reset link for @iso');
    expect(sent).toEqual([{ currentPassword: 'my password', code: '123456' }]);
  });

  it("asks for nothing extra on someone else's reset link", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/users/u2/password-link' && init?.method === 'POST') {
        sent.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ token: 'c'.repeat(43), purpose: 'reset', expiresAt: '2026-11-08T12:00:00.000Z' }), { status: 201 });
      }
      if (url === '/api/users') return new Response(JSON.stringify([{ ...member, hasPassword: true, passwordLink: null, twoStepEnabled: true }]));
      if (url === '/api/users/u2/permissions') return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    expect(screen.queryByLabelText('Your current password')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Make link' }));
    await screen.findByLabelText('Password reset link for @iso');
    expect(sent).toEqual([{}]);
  });

  it('offers no turn-off for your own account', async () => {
    mocks.me = { id: 'u2' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/users') return new Response(JSON.stringify([{ ...member, hasPassword: true, passwordLink: null, twoStepEnabled: true }]));
      if (url === '/api/users/u2/permissions') return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    expect(await screen.findByRole('link', { name: 'Account → Two-step sign-in' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
  });
});

describe('API tokens in the editor', () => {
  const token = {
    id: 'tok-1', name: 'Homepage', scopes: ['activity.view'], activeScopes: ['activity.view'],
    expiresAt: null, createdAt: '2026-11-01T00:00:00.000Z', lastUsedAt: null,
  };

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><UsersAdminPage /></QueryClientProvider>);
  }

  it("lists a user's tokens and turns one off after a confirm", async () => {
    let tokens = [token];
    const deletes: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/users/u2/api-tokens/tok-1' && init?.method === 'DELETE') {
        deletes.push(url);
        tokens = [];
        return new Response(JSON.stringify({ revoked: true }));
      }
      if (url === '/api/users/u2/api-tokens') return new Response(JSON.stringify({ tokens, allowed: true }));
      if (url === '/api/users') return new Response(JSON.stringify([{ ...member, hasPassword: true, passwordLink: null }]));
      if (url === '/api/users/u2/permissions') return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    expect(await screen.findByText('Homepage')).toBeDefined();
    expect(screen.getByText(/Made .* · not used yet · no expiry/)).toBeDefined();
    expect(screen.getByText('Download queue (size and items)')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Turn off Homepage' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm.textContent).toContain('Turn off “Homepage” for Iso?');
    expect(deletes).toEqual([]);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(deletes).toEqual(['/api/users/u2/api-tokens/tok-1']));
    await waitFor(() => expect(screen.queryByText('Homepage')).toBeNull());
  });

  it('says when their tokens do not work because api.tokens is off for them', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/users/u2/api-tokens') return new Response(JSON.stringify({ tokens: [token], allowed: false }));
      if (url === '/api/users') return new Response(JSON.stringify([{ ...member, hasPassword: true, passwordLink: null }]));
      if (url === '/api/users/u2/permissions') return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    expect(await screen.findByText(/These don.t work: “Make personal API tokens” is off for them/)).toBeDefined();
  });
});

describe('giving admin asks for your password, and a code while your two-step sign-in is on', () => {
  const me = { ...member, id: 'me', username: 'boss', displayName: 'Boss', role: 'admin', hasPassword: true, passwordLink: null };

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><UsersAdminPage /></QueryClientProvider>);
  }

  function stubUsers(list: unknown[], sent: Array<{ url: string; body: unknown }>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' || init?.method === 'PATCH') {
        sent.push({ url, body: JSON.parse(init.body as string) });
        if (url.endsWith('/password-link')) {
          return new Response(JSON.stringify({ token: 'c'.repeat(43), purpose: 'reset', expiresAt: '2026-11-08T12:00:00.000Z' }), { status: 201 });
        }
        return new Response(JSON.stringify({ ...member, id: 'u3' }), { status: url === '/api/users' ? 201 : 200 });
      }
      if (url === '/api/users') return new Response(JSON.stringify(list));
      if (url.endsWith('/permissions')) return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
  }

  it('adds an admin only with your password and code, and a member with neither', async () => {
    mocks.me = { id: 'me' };
    const sent: Array<{ url: string; body: unknown }> = [];
    stubUsers([{ ...me, twoStepEnabled: true }, member], sent);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await userEvent.type(screen.getByLabelText('Username'), 'newbie');
    await userEvent.type(screen.getByLabelText('Display name'), 'New');
    expect(screen.queryByLabelText('Your current password')).toBeNull();

    await userEvent.click(screen.getAllByRole('combobox')[0]);
    await userEvent.click(await screen.findByRole('option', { name: 'Admin' }));
    const create = screen.getByRole('button', { name: 'Create and get link' });
    expect(create.hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('Your current password'), 'my password');
    expect(create.hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('Authenticator or recovery code'), ' 123456 ');
    await userEvent.click(create);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toMatchObject({ role: 'admin', currentPassword: 'my password', code: '123456' });
  });

  it('makes a member admin with your password alone while your two-step sign-in is off', async () => {
    mocks.me = { id: 'me' };
    const sent: Array<{ url: string; body: unknown }> = [];
    stubUsers([{ ...me, twoStepEnabled: false }, { ...member, hasPassword: true, passwordLink: null }], sent);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    expect(screen.queryByLabelText('Your current password')).toBeNull();
    await userEvent.click(screen.getAllByRole('combobox')[0]);
    await userEvent.click(await screen.findByRole('option', { name: 'Admin' }));
    expect(screen.queryByLabelText('Authenticator or recovery code')).toBeNull();
    const save = screen.getByRole('button', { name: 'Save details' });
    expect(save.hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('Your current password'), 'my password');
    await userEvent.click(save);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: '/api/users/u2', body: { role: 'admin', currentPassword: 'my password' } });
    expect(sent[0].body).not.toHaveProperty('code');
  });

  it("asks before another admin's reset link, but not before a member's edit", async () => {
    mocks.me = { id: 'me' };
    const sent: Array<{ url: string; body: unknown }> = [];
    const other = { ...member, role: 'admin', hasPassword: true, passwordLink: null, twoStepEnabled: false };
    stubUsers([{ ...me, twoStepEnabled: true }, other], sent);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    const make = await screen.findByRole('button', { name: 'Make link' });
    expect(make.hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('Your current password'), 'my password');
    await userEvent.type(screen.getByLabelText('Authenticator or recovery code'), '123456');
    await userEvent.click(make);
    await screen.findByLabelText('Password reset link for @iso');
    expect(sent).toEqual([{ url: '/api/users/u2/password-link', body: { currentPassword: 'my password', code: '123456' } }]);
  });

  it('shows the fields when the server asks, though the list said member (made admin elsewhere)', async () => {
    mocks.me = { id: 'me' };
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/users/u2/password-link' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        sent.push(body);
        if (!body.currentPassword) {
          return new Response(JSON.stringify({ error: 'Giving admin access needs your current password.', needsStepUp: true, needsCode: false }), { status: 403 });
        }
        return new Response(JSON.stringify({ token: 'c'.repeat(43), purpose: 'reset', expiresAt: '2026-11-08T12:00:00.000Z' }), { status: 201 });
      }
      if (url === '/api/users') return new Response(JSON.stringify([{ ...me, twoStepEnabled: false }, { ...member, hasPassword: true, passwordLink: null }]));
      if (url.endsWith('/permissions')) return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    expect(screen.queryByLabelText('Your current password')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Make link' }));
    await userEvent.type(await screen.findByLabelText('Your current password'), 'my password');
    expect(screen.queryByLabelText('Authenticator or recovery code')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Make link' }));
    await screen.findByLabelText('Password reset link for @iso');
    expect(sent).toEqual([{}, { currentPassword: 'my password' }]);
  });
});

describe('round 10: the Admin template, turning an admin back on, and another admin’s two-step', () => {
  const me = { ...member, id: 'me', username: 'boss', displayName: 'Boss', role: 'admin', hasPassword: true, passwordLink: null, twoStepEnabled: true };

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><UsersAdminPage /></QueryClientProvider>);
  }

  function stub(target: Record<string, unknown>, sent: Array<{ url: string; method: string; body: unknown }>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method && init.method !== 'GET') {
        sent.push({ url, method: init.method, body: init.body ? JSON.parse(init.body as string) : undefined });
        if (url.endsWith('/permissions')) {
          const body = JSON.parse(init.body as string);
          return new Response(JSON.stringify({ template: body.template, effective: { 'movies.add': true } }));
        }
        return new Response(JSON.stringify({ ok: true, ...member }));
      }
      if (url === '/api/users') return new Response(JSON.stringify([me, target]));
      if (url.endsWith('/permissions')) return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
  }

  it('the Admin template waits for your password and code; the Member template applies at once', async () => {
    mocks.me = { id: 'me' };
    const sent: Array<{ url: string; method: string; body: unknown }> = [];
    stub({ ...member, hasPassword: true, passwordLink: null, twoStepEnabled: false }, sent);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    await screen.findByRole('switch', { name: 'Add movies to library' });

    await userEvent.click(screen.getAllByRole('combobox').at(-1)!);
    await userEvent.click(await screen.findByRole('option', { name: 'Admin template' }));
    expect(sent).toEqual([]);
    const apply = screen.getByRole('button', { name: 'Apply Admin template' });
    expect(apply.hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('Your current password'), 'my password');
    await userEvent.type(screen.getByLabelText('Authenticator or recovery code'), '123456');
    await userEvent.click(apply);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      url: '/api/users/u2/permissions', method: 'PUT',
      body: { template: 'admin', currentPassword: 'my password', code: '123456' },
    });
    await waitFor(() => expect(screen.queryByLabelText('Your current password')).toBeNull());

    await userEvent.click(screen.getAllByRole('combobox').at(-1)!);
    await userEvent.click(await screen.findByRole('option', { name: 'Member template' }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].body).toEqual({ template: 'member' });
  });

  it('backing out of the Admin template through the menu sends nothing (it would clear their overrides)', async () => {
    mocks.me = { id: 'me' };
    const sent: Array<{ url: string; method: string; body: unknown }> = [];
    stub({ ...member, hasPassword: true, passwordLink: null, twoStepEnabled: false }, sent);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    await screen.findByRole('switch', { name: 'Add movies to library' });
    await userEvent.click(screen.getAllByRole('combobox').at(-1)!);
    await userEvent.click(await screen.findByRole('option', { name: 'Admin template' }));
    await userEvent.click(screen.getAllByRole('combobox').at(-1)!);
    await userEvent.click(await screen.findByRole('option', { name: 'Member template' }));
    expect(screen.queryByRole('button', { name: 'Apply Admin template' })).toBeNull();
    expect(sent).toEqual([]);
  });

  it('a toggle the server refuses for every capability shows the fields, and the next one sends them', async () => {
    mocks.me = { id: 'me' };
    const sent: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body as string);
        sent.push({ url, method: 'PUT', body });
        if (!body.currentPassword) {
          return new Response(JSON.stringify({ error: 'Giving every capability needs your current password.', needsStepUp: true, needsCode: false }), { status: 403 });
        }
        return new Response(JSON.stringify({ template: 'member', effective: { 'movies.add': true } }));
      }
      if (url === '/api/users') return new Response(JSON.stringify([{ ...me, twoStepEnabled: false }, { ...member, hasPassword: true, passwordLink: null, twoStepEnabled: false }]));
      if (url.endsWith('/permissions')) return new Response(JSON.stringify(mocks.permissions));
      return new Response(JSON.stringify([]));
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    const toggle = await screen.findByRole('switch', { name: 'Add movies to library' });
    await userEvent.click(toggle);
    await userEvent.type(await screen.findByLabelText('Your current password'), 'my password');
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    await userEvent.click(toggle);
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].body).toMatchObject({ permissions: { 'movies.add': true }, currentPassword: 'my password' });
    await waitFor(() => expect(screen.queryByLabelText('Your current password')).toBeNull());
  });

  it('turning a disabled admin back on asks for your password and code; a disabled member does not', async () => {
    mocks.me = { id: 'me' };
    const sent: Array<{ url: string; method: string; body: unknown }> = [];
    stub({ ...member, role: 'admin', status: 'disabled', hasPassword: true, passwordLink: null, twoStepEnabled: false }, sent);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    expect(screen.queryByLabelText('Your current password')).toBeNull();
    await userEvent.click(screen.getAllByRole('combobox')[1]);
    await userEvent.click(await screen.findByRole('option', { name: 'Active' }));
    const save = screen.getByRole('button', { name: 'Save details' });
    expect(save.hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('Your current password'), 'my password');
    await userEvent.type(screen.getByLabelText('Authenticator or recovery code'), '123456');
    await userEvent.click(save);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toMatchObject({ status: 'active', currentPassword: 'my password', code: '123456' });
  });

  it('a disabled member turns back on with no password asked', async () => {
    mocks.me = { id: 'me' };
    const sent: Array<{ url: string; method: string; body: unknown }> = [];
    stub({ ...member, status: 'disabled', hasPassword: true, passwordLink: null, twoStepEnabled: false }, sent);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    await userEvent.click(screen.getAllByRole('combobox')[1]);
    await userEvent.click(await screen.findByRole('option', { name: 'Active' }));
    expect(screen.queryByLabelText('Your current password')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).not.toHaveProperty('currentPassword');
  });

  it("turning off another admin's two-step sends your password and code; a member's sends nothing", async () => {
    mocks.me = { id: 'me' };
    const sent: Array<{ url: string; method: string; body: unknown }> = [];
    stub({ ...member, role: 'admin', hasPassword: true, passwordLink: null, twoStepEnabled: true }, sent);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    const turnOff = await screen.findByRole('button', { name: 'Turn off' });
    expect(turnOff.hasAttribute('disabled')).toBe(true);
    // The two-step section's own fields (the reset link asks for its own too).
    const passwords = screen.getAllByLabelText('Your current password');
    const codes = screen.getAllByLabelText('Authenticator or recovery code');
    await userEvent.type(passwords.at(-1)!, 'my password');
    await userEvent.type(codes.at(-1)!, '123456');
    await userEvent.click(turnOff);
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: '/api/users/u2/totp', method: 'DELETE', body: { currentPassword: 'my password', code: '123456' } });
  });

  it("a member's two-step turns off with no body", async () => {
    mocks.me = { id: 'me' };
    const sent: Array<{ url: string; method: string; body: unknown }> = [];
    stub({ ...member, hasPassword: true, passwordLink: null, twoStepEnabled: true }, sent);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Iso/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: '/api/users/u2/totp', method: 'DELETE', body: undefined });
  });
});
