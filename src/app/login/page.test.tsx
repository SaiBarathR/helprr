// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  clearUserScopedBrowserCaches: vi.fn(),
  boundaryListeners: new Set<() => void>(),
}));
// One router for every render, so a redirect can be checked.
const router = { replace: mocks.replace, refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/query-client', () => ({ getQueryClient: () => ({ clear: vi.fn() }) }));
vi.mock('@/lib/hooks/use-external-urls', () => ({ invalidateExternalUrls: vi.fn() }));
vi.mock('@/lib/client-cache', () => ({
  broadcastAuthenticationBoundary: vi.fn(),
  clearUserScopedBrowserCaches: mocks.clearUserScopedBrowserCaches,
  requestSessionLogout: vi.fn(),
  subscribeToAuthenticationBoundaries: (onBoundary: () => void) => {
    mocks.boundaryListeners.add(onBoundary);
    return () => mocks.boundaryListeners.delete(onBoundary);
  },
}));
import LoginPage from './page';

let root: Root;
let container: HTMLDivElement;
let mounted: boolean;

function meAnswers(response: Promise<Response>) {
  const fetchMock = vi.fn(() => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openLogin() {
  await act(async () => root.render(<LoginPage />));
  mounted = true;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.clearUserScopedBrowserCaches.mockResolvedValue(undefined);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = false;
});

afterEach(() => {
  sessionStorage.clear();
  if (mounted) act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Login page', () => {
  it('clears what an ended session left in this browser once the server confirms it is gone', async () => {
    const fetchMock = meAnswers(Promise.resolve(Response.json({ error: 'Unauthorized' }, { status: 401 })));
    await openLogin();
    expect(fetchMock).toHaveBeenCalledWith('/api/me', { cache: 'no-store' });
    expect(mocks.clearUserScopedBrowserCaches).toHaveBeenCalledTimes(1);
  });

  it('keeps the caches of a visitor who is still signed in', async () => {
    meAnswers(Promise.resolve(Response.json({ id: 'u1' })));
    await openLogin();
    expect(mocks.clearUserScopedBrowserCaches).not.toHaveBeenCalled();
  });

  it('keeps the caches when it cannot reach the server', async () => {
    meAnswers(Promise.reject(new TypeError('Failed to fetch')));
    await openLogin();
    expect(mocks.clearUserScopedBrowserCaches).not.toHaveBeenCalled();
  });

  it('still shows the sign-in form when the clear fails', async () => {
    meAnswers(Promise.resolve(new Response(null, { status: 401 })));
    mocks.clearUserScopedBrowserCaches.mockRejectedValue(new Error('Timed out clearing user-scoped caches'));
    await openLogin();
    expect(mocks.clearUserScopedBrowserCaches).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button')?.textContent).toContain('Sign In');
  });

  it('does not clear after Login has been left, so a new sign-in keeps its caches', async () => {
    let answer!: (response: Response) => void;
    meAnswers(new Promise<Response>((resolve) => { answer = resolve; }));
    await openLogin();
    act(() => root.unmount());
    mounted = false;
    await act(async () => answer(new Response(null, { status: 401 })));
    expect(mocks.clearUserScopedBrowserCaches).not.toHaveBeenCalled();
    expect(mocks.boundaryListeners.size).toBe(0);
  });

  it('does not clear on a late answer once another tab has signed in', async () => {
    let answer!: (response: Response) => void;
    meAnswers(new Promise<Response>((resolve) => { answer = resolve; }));
    await openLogin();
    act(() => mocks.boundaryListeners.forEach((listener) => listener()));
    await act(async () => answer(new Response(null, { status: 401 })));
    expect(mocks.clearUserScopedBrowserCaches).not.toHaveBeenCalled();
  });

  it('tells someone who forgot their password how to get back in', async () => {
    meAnswers(Promise.resolve(new Response(null, { status: 401 })));
    await openLogin();
    const details = container.querySelector('details')!;
    const summary = details.querySelector('summary')!;
    expect(summary.textContent).toBe('Forgot your password?');
    expect(details.open).toBe(false);
    act(() => summary.click());
    expect(details.open).toBe(true);
    expect(details.textContent).toContain('Ask whoever runs Helprr to reset it in Settings → Users.');
    const link = details.querySelector('a')!;
    expect(link.textContent).toBe('Recover the admin account');
    expect(link.getAttribute('href')).toBe('https://saibarathr.github.io/helprr/troubleshooting/#signing-in');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  describe('two-step sign-in', () => {
    function type(input: HTMLInputElement, value: string) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    function answers(routes: Record<string, () => Response>) {
      const fetchMock = vi.fn(async (url: string) => routes[url]?.() ?? Response.json({ error: 'Unauthorized' }, { status: 401 }));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    async function signInWithPassword() {
      await openLogin();
      const [username, password] = [...container.querySelectorAll('input')] as HTMLInputElement[];
      type(username, 'member');
      type(password, 'correct horse battery');
      await act(async () => container.querySelector('form')!.requestSubmit());
    }

    it('asks for the code after a right password, and signs in with it', async () => {
      const fetchMock = answers({
        '/api/auth/login': () => Response.json({ mfaRequired: true, mfaToken: 'pending-token' }),
        '/api/auth/login/totp': () => Response.json({ success: true }),
      });
      await signInWithPassword();

      expect(mocks.replace).not.toHaveBeenCalled();
      const code = container.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
      expect(code).not.toBeNull();
      expect(container.textContent).toContain('Enter the 6-digit code from your authenticator app.');
      type(code, '123456');
      await act(async () => container.querySelector('form')!.requestSubmit());

      const call = fetchMock.mock.calls.find(([url]) => url === '/api/auth/login/totp') as unknown as [string, RequestInit];
      expect(JSON.parse(String(call[1].body))).toEqual({ mfaToken: 'pending-token', code: '123456' });
      expect(mocks.replace).toHaveBeenCalledWith('/');
    });

    it('comes back to the code step after a reload while the token is good, and not after', async () => {
      answers({
        '/api/auth/login': () => Response.json({ mfaRequired: true, mfaToken: 'pending-token' }),
      });
      await signInWithPassword();
      act(() => root.unmount());
      root = createRoot(container);
      await openLogin();
      expect(container.querySelector('input[autocomplete="one-time-code"]')).not.toBeNull();

      act(() => root.unmount());
      sessionStorage.setItem('helprr-mfa-pending', JSON.stringify({ token: 'old', until: Date.now() - 1 }));
      root = createRoot(container);
      await openLogin();
      expect(container.querySelector('input[autocomplete="one-time-code"]')).toBeNull();
      expect(sessionStorage.getItem('helprr-mfa-pending')).toBeNull();
    });

    it('goes back to the password when the code step timed out', async () => {
      answers({
        '/api/auth/login': () => Response.json({ mfaRequired: true, mfaToken: 'pending-token' }),
        '/api/auth/login/totp': () => Response.json({ error: 'Your sign-in timed out. Enter your password again.', mfaExpired: true }, { status: 401 }),
      });
      await signInWithPassword();
      type(container.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement, '123456');
      await act(async () => container.querySelector('form')!.requestSubmit());

      expect(container.querySelector('input[type="password"]')).not.toBeNull();
      expect(container.textContent).toContain('Your sign-in timed out. Enter your password again.');
      expect(mocks.replace).not.toHaveBeenCalled();
    });

    it('a wrong code keeps the code step with the error', async () => {
      answers({
        '/api/auth/login': () => Response.json({ mfaRequired: true, mfaToken: 'pending-token' }),
        '/api/auth/login/totp': () => Response.json({ error: 'That code didn’t work. Try again.' }, { status: 401 }),
      });
      await signInWithPassword();
      type(container.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement, '000000');
      await act(async () => container.querySelector('form')!.requestSubmit());

      expect(container.querySelector('input[autocomplete="one-time-code"]')).not.toBeNull();
      expect(container.textContent).toContain('That code didn’t work. Try again.');
    });
  });

  describe('trusted-header sign-in', () => {
    function answers(trusted: { enabled: boolean; signedOut?: boolean; post?: () => Response }) {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url !== '/api/auth/trusted') return Response.json({ error: 'Unauthorized' }, { status: 401 });
        if (init?.method === 'POST') return trusted.post!();
        return Response.json({ enabled: trusted.enabled, signedOut: trusted.signedOut ?? false });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    const posts = (fetchMock: ReturnType<typeof answers>) =>
      fetchMock.mock.calls.filter(([url, init]) => url === '/api/auth/trusted' && init?.method === 'POST');

    it('signs straight in once through the proxy when the server has it on', async () => {
      const fetchMock = answers({ enabled: true, post: () => Response.json({ success: true }) });
      await openLogin();
      const calls = posts(fetchMock);
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toMatchObject({ headers: { 'Content-Type': 'application/json' } });
      expect(mocks.clearUserScopedBrowserCaches).toHaveBeenCalled();
      expect(mocks.replace).toHaveBeenCalledWith('/');
    });

    it('never tries when the server has it off', async () => {
      const fetchMock = answers({ enabled: false });
      await openLogin();
      expect(posts(fetchMock)).toHaveLength(0);
      expect(mocks.replace).not.toHaveBeenCalled();
    });

    it('shows the normal form, with no error, when not reached through the proxy', async () => {
      answers({ enabled: true, post: () => Response.json({ error: 'not from the proxy' }, { status: 401 }) });
      await openLogin();
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Sign in to continue');
      expect(container.textContent).not.toContain('not from the proxy');
      expect(container.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false);
    });

    describe('after signing out', () => {
      const signInButton = () =>
        [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Sign in');

      it('shows Signed out and waits for a tap instead of signing straight back in', async () => {
        const fetchMock = answers({ enabled: true, signedOut: true, post: () => Response.json({ success: true }) });
        await openLogin();
        expect(posts(fetchMock)).toHaveLength(0);
        expect(mocks.replace).not.toHaveBeenCalled();
        expect(container.textContent).toContain('Signed out');
        expect(container.querySelector('input[type="password"]')).toBeNull();

        await act(async () => signInButton()!.click());
        expect(posts(fetchMock)).toHaveLength(1);
        expect(mocks.replace).toHaveBeenCalledWith('/');
        // Still busy while the app loads, so a second tap cannot sign in twice.
        expect(signInButton()?.hasAttribute('disabled')).toBe(true);
      });

      it('shows the normal form after the tap when not reached through the proxy', async () => {
        const fetchMock = answers({
          enabled: true,
          signedOut: true,
          post: () => Response.json({ error: 'not from the proxy' }, { status: 401 }),
        });
        await openLogin();
        await act(async () => signInButton()!.click());
        expect(posts(fetchMock)).toHaveLength(1);
        expect(mocks.replace).not.toHaveBeenCalled();
        expect(container.textContent).toContain('Sign in to continue');
        expect(container.querySelector('input[type="password"]')).not.toBeNull();
      });

      it('keeps the error when the proxy named no Helprr account', async () => {
        answers({
          enabled: true,
          signedOut: true,
          post: () => Response.json({ error: 'Your sign-in proxy named no active Helprr account.' }, { status: 403 }),
        });
        await openLogin();
        await act(async () => signInButton()!.click());
        expect(container.textContent).toContain('Your sign-in proxy named no active Helprr account.');
        expect(container.querySelector('input[type="password"]')).not.toBeNull();
      });

      it('ignores the marker when proxy sign-in is off', async () => {
        const fetchMock = answers({ enabled: false, signedOut: true });
        await openLogin();
        expect(posts(fetchMock)).toHaveLength(0);
        expect(container.textContent).toContain('Sign in to continue');
      });
    });

    it('says why when the proxy named no Helprr account, and keeps the form', async () => {
      answers({ enabled: true, post: () => Response.json({ error: 'Your sign-in proxy named no active Helprr account.' }, { status: 403 }) });
      await openLogin();
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Your sign-in proxy named no active Helprr account.');
      expect(container.querySelector('input[type="password"]')).not.toBeNull();
    });
  });

  describe('a brand-new install', () => {
    function answers(setupState: Promise<Response>) {
      vi.stubGlobal('fetch', vi.fn((url: string) => (
        url === '/api/setup/state' ? setupState : Promise.resolve(Response.json({ error: 'Unauthorized' }, { status: 401 }))
      )));
    }

    it('goes to /setup while the first admin is still needed', async () => {
      answers(Promise.resolve(Response.json({ needsAdmin: true })));
      await openLogin();
      expect(mocks.replace).toHaveBeenCalledWith('/setup');
    });

    it('stays on the sign-in form once there is an admin', async () => {
      answers(Promise.resolve(Response.json({ needsAdmin: false })));
      await openLogin();
      expect(mocks.replace).not.toHaveBeenCalled();
    });

    it('stays on the sign-in form when the check fails', async () => {
      answers(Promise.reject(new Error('offline')));
      await openLogin();
      expect(mocks.replace).not.toHaveBeenCalled();
    });
  });
});
