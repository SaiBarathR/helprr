// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'b'.repeat(43);
const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), complete: vi.fn() }));
const router = { replace: mocks.replace, refresh: mocks.refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
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

async function open(hash = `#${TOKEN}`) {
  window.history.replaceState(null, '', `/invite${hash}`);
  await act(async () => { render(<InvitePage />); });
}

async function submit(password: string, again = password) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Password again'), { target: { value: again } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Set password and sign in' })); });
}

describe('/invite', () => {
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

  it('sends someone with two-step sign-in to sign in with a code instead of signing them in', async () => {
    accept = () => Promise.resolve(Response.json({ success: true, signInWithCode: true }));
    await open();
    await submit(PASSWORD);

    expect(screen.getByRole('status').textContent).toBe('Your password is set. Sign in with it and a code from your authenticator app.');
    expect(screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe('/login');
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('after a reset that turned two-step sign-in off, sends them to sign in with the new password', async () => {
    accept = () => Promise.resolve(Response.json({ success: true, twoStepTurnedOff: true }));
    await open();
    await submit(PASSWORD);

    expect(screen.getByRole('status').textContent).toBe('Your password is set and two-step sign-in is off. Sign in with your new password.');
    expect(screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe('/login');
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('reads the token from the fragment once and drops it from the address bar', async () => {
    await open();
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(window.location.pathname).toBe('/invite');
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN });
  });

  it('asks for the link again when the address has no token, without asking the server', async () => {
    await open('');
    expect(screen.getByRole('alert').textContent).toBe('Open the link from your message again. This address has no link key in it.');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('says only that the link does not work, for any unusable link', async () => {
    state = () => Promise.resolve(Response.json({ error: 'whatever the server says' }, { status: 404 }));
    await open();
    expect(screen.getByRole('alert').textContent).toBe(INVALID);
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('reads a new link opened in the same tab, where only the fragment changes', async () => {
    state = () => Promise.resolve(Response.json({ error: 'gone' }, { status: 404 }));
    await open('#old-link');
    expect(screen.getByRole('alert').textContent).toBe(INVALID);

    state = () => Promise.resolve(Response.json({ purpose: 'invite', username: 'newbie', displayName: 'New Person' }));
    await act(async () => {
      window.history.replaceState(null, '', `/invite#${TOKEN}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(screen.getByText('Welcome, New Person')).toBeDefined());
    await submit(PASSWORD);
    const [, init] = vi.mocked(fetch).mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN, password: PASSWORD });
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
