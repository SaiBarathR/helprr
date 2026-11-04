// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), complete: vi.fn() }));
const router = { replace: mocks.replace, refresh: mocks.refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/client-sign-in', () => ({ completeBrowserSignIn: mocks.complete, setDeviceCookieFromMatchMedia: vi.fn() }));

import SetupPage from './page';

const PASSWORD = 'a-long-first-admin-password';
let claim: () => Promise<Response>;
let state: () => Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.complete.mockResolvedValue(undefined);
  state = () => Promise.resolve(Response.json({ needsAdmin: true }));
  claim = () => Promise.resolve(Response.json({ success: true }));
  vi.stubGlobal('fetch', vi.fn((url: string) => (url === '/api/setup/state' ? state() : claim())));
});

async function open() {
  await act(async () => { render(<SetupPage />); });
}

async function submit(password: string, again = password) {
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Password again'), { target: { value: again } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create admin' })); });
}

describe('/setup', () => {
  it('sends people to sign in once an admin exists', async () => {
    state = () => Promise.resolve(Response.json({ needsAdmin: false }));
    await open();
    expect(mocks.replace).toHaveBeenCalledWith('/login');
    expect(screen.queryByText('Welcome to Helprr')).toBeNull();
  });

  it('offers a retry instead of a dead end when Helprr cannot be reached', async () => {
    state = () => Promise.reject(new Error('offline'));
    await open();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByText(/Couldn.t reach Helprr/)).toBeDefined();
    state = () => Promise.resolve(Response.json({ needsAdmin: true }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(screen.getByText('Welcome to Helprr')).toBeDefined();
  });

  it('checks the password before asking the server', async () => {
    await open();
    await submit('short');
    expect(screen.getByRole('alert').textContent).toBe('Use at least 15 characters.');
    await submit(PASSWORD, `${PASSWORD}x`);
    expect(screen.getByRole('alert').textContent).toBe('The two passwords are different.');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('counts characters, not UTF-16 units, as the server does', async () => {
    await open();
    await submit('🔒'.repeat(8));
    expect(screen.getByRole('alert').textContent).toBe('Use at least 15 characters.');
  });

  it('creates the admin, prepares the browser and enters Helprr', async () => {
    await open();
    await submit(PASSWORD);
    expect(mocks.complete).toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });

  it.each([404, 409])('sends the loser of a race (%i) to sign in', async (status) => {
    claim = () => Promise.resolve(Response.json({ error: 'An admin already exists. Sign in instead.' }, { status }));
    await open();
    await submit(PASSWORD);
    expect(mocks.replace).toHaveBeenCalledWith('/login');
  });

  it("shows the server's reason", async () => {
    claim = () => Promise.resolve(Response.json({ error: 'Username is too long' }, { status: 400 }));
    await open();
    await submit(PASSWORD);
    expect(screen.getByRole('alert').textContent).toBe('Username is too long');
  });

  it('says the admin exists when only the browser could not be prepared', async () => {
    mocks.complete.mockRejectedValue(new Error('Could not safely clear browser data. Please retry.'));
    await open();
    await submit(PASSWORD);
    expect(screen.getByRole('alert').textContent).toMatch(/admin account was created/);
  });
});
