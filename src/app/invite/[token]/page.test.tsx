// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'b'.repeat(43);
const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), complete: vi.fn() }));
const router = { replace: mocks.replace, refresh: mocks.refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ token: 'b'.repeat(43) }) }));
vi.mock('@/lib/client-sign-in', () => ({ completeBrowserSignIn: mocks.complete, setDeviceCookieFromMatchMedia: vi.fn() }));

import InvitePage from './page';

const PASSWORD = 'a-long-chosen-password';
const INVALID = 'This link is invalid or has expired. Ask your admin for a new one.';
let state: () => Promise<Response>;
let accept: () => Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.complete.mockResolvedValue(undefined);
  state = () => Promise.resolve(Response.json({ purpose: 'invite', username: 'newbie', displayName: 'New Person' }));
  accept = () => Promise.resolve(Response.json({ success: true }));
  vi.stubGlobal('fetch', vi.fn((url: string) => (url === '/api/invite/state' ? state() : accept())));
});

async function open() {
  await act(async () => { render(<InvitePage />); });
}

async function submit(password: string, again = password) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Password again'), { target: { value: again } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Set password and sign in' })); });
}

describe('/invite/[token]', () => {
  it('greets the invited person and signs them in with the password they choose', async () => {
    await open();
    expect(screen.getByText('Welcome, New Person')).toBeDefined();
    expect(screen.getByText('@newbie')).toBeDefined();

    await submit(PASSWORD);

    const [, init] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN, password: PASSWORD });
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });

  it('says only that the link does not work, for any unusable link', async () => {
    state = () => Promise.resolve(Response.json({ error: 'whatever the server says' }, { status: 404 }));
    await open();
    expect(screen.getByRole('alert').textContent).toBe(INVALID);
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('shows the same answer when the link stops working before the password is sent', async () => {
    accept = () => Promise.resolve(Response.json({ error: INVALID }, { status: 404 }));
    await open();
    await submit(PASSWORD);
    expect(screen.getByRole('alert').textContent).toBe(INVALID);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('checks the password before asking the server', async () => {
    await open();
    await submit('short');
    expect(screen.getByRole('alert').textContent).toBe('Use at least 15 characters.');
    await submit(PASSWORD, `${PASSWORD}x`);
    expect(screen.getByRole('alert').textContent).toBe('The two passwords are different.');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when throttled, and words a reset link as a reset', async () => {
    state = () => Promise.resolve(Response.json({ error: 'Too many login attempts. Try again in 1 minute.' }, { status: 429 }));
    await open();
    expect(screen.getByRole('alert').textContent).toContain('Too many');
    state = () => Promise.resolve(Response.json({ purpose: 'reset', username: 'member', displayName: 'Member' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(screen.getByText('Reset your password')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Set new password' })).toBeDefined();
  });
});
