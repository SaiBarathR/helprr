// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  endSession: vi.fn(),
  revokeResponse: null as null | (() => void),
  revokeFailure: null as null | 'network' | 'refused' | 'gateway' | 'stall',
  groups: [] as unknown[],
  pages: {} as Record<string, unknown>,
}));

vi.mock('@/lib/client-cache', () => ({
  endSessionInThisBrowser: mocks.endSession,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// The confirm dialog is reduced to its confirm button.
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({ open, confirmLabel, onConfirm }: {
    open: boolean;
    confirmLabel?: string;
    onConfirm: () => void;
  }) => (open ? <button data-confirm onClick={onConfirm}>{confirmLabel}</button> : null),
}));

import SessionsPage from './page';

function session(id: string, label: string, isCurrent = false) {
  return { id, label, userAgent: null, ip: null, createdAt: '2026-10-01T00:00:00Z', lastSeenAt: null, isCurrent };
}

const OWN_GROUP = {
  userId: 'me',
  ownerName: 'Me',
  isOwn: true,
  total: 2,
  hasMore: false,
  sessions: [session('current', 'This Mac', true), session('other', 'Phone')],
};

let root: Root;
let container: HTMLElement;
let client: QueryClient;

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><SessionsPage /></QueryClientProvider>);
  });
  await flush();
}

async function confirmRevoke(rowButton: 'Sign out this device' | 'Revoke Phone') {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${rowButton}"]`)!;
  await act(async () => button.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[data-confirm]')!.click());
}

beforeEach(() => {
  mocks.endSession.mockReset();
  mocks.revokeResponse = null;
  mocks.revokeFailure = null;
  mocks.groups = [OWN_GROUP];
  mocks.pages = {};
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/sessions') return Response.json({ groups: mocks.groups });
    if (url in mocks.pages) return Response.json(mocks.pages[url]);
    if (init?.method === 'POST' && url.endsWith('/revoke')) {
      if (mocks.revokeFailure === 'network') throw new TypeError('Failed to fetch');
      if (mocks.revokeFailure === 'refused') return Response.json({ error: 'Failed' }, { status: 500 });
      if (mocks.revokeFailure === 'gateway') return new Response('Bad gateway', { status: 502 });
      if (mocks.revokeFailure === 'stall') {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }
      const body = Response.json({ wasCurrent: url.includes('/current/') });
      if (!mocks.revokeResponse) return body;
      // Hold the response until the test releases it.
      return new Promise<Response>((resolve) => {
        mocks.revokeResponse = () => resolve(body);
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Settings → Sessions revoke', () => {
  it('ends this browser session when the current session is revoked', async () => {
    await renderPage();
    await confirmRevoke('Sign out this device');
    await flush();

    expect(mocks.endSession).toHaveBeenCalledOnce();
  });

  it('still ends this browser session when the page was left before the response', async () => {
    mocks.revokeResponse = () => undefined;
    await renderPage();
    await confirmRevoke('Sign out this device');
    act(() => root.unmount());
    await act(async () => mocks.revokeResponse?.());
    await flush();

    expect(mocks.endSession).toHaveBeenCalledOnce();
    root = createRoot(container);
  });

  it('leaves this browser alone when another session is revoked', async () => {
    await renderPage();
    await confirmRevoke('Revoke Phone');
    await flush();

    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('ends this browser session when revoking it loses the response', async () => {
    mocks.revokeFailure = 'network';
    await renderPage();
    await confirmRevoke('Sign out this device');
    await flush();

    expect(mocks.endSession).toHaveBeenCalledOnce();
  });

  it('keeps this browser session when the server refuses the revoke', async () => {
    mocks.revokeFailure = 'refused';
    await renderPage();
    await confirmRevoke('Sign out this device');
    await flush();

    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('does not end this browser session when revoking another one loses the response', async () => {
    mocks.revokeFailure = 'network';
    await renderPage();
    await confirmRevoke('Revoke Phone');
    await flush();

    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('ends this browser session when a gateway error hides the revoke result', async () => {
    mocks.revokeFailure = 'gateway';
    await renderPage();
    await confirmRevoke('Sign out this device');
    await flush();

    expect(mocks.endSession).toHaveBeenCalledOnce();
  });

  it('gives up waiting after the timeout and ends this browser session', async () => {
    mocks.revokeFailure = 'stall';
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), 0);
      return controller.signal;
    });
    await renderPage();
    await confirmRevoke('Sign out this device');
    await flush();
    timeout.mockRestore();

    expect(mocks.endSession).toHaveBeenCalledOnce();
  });
});

describe('Settings → Sessions list', () => {
  const sectionTitles = () =>
    [...container.querySelectorAll('.grouped-section-title')].map((el) => el.textContent);
  const rowNames = () =>
    [...container.querySelectorAll('.grouped-row div.font-medium')].map((el) => el.textContent);

  it('groups an admin view by person with counts', async () => {
    mocks.groups = [
      OWN_GROUP,
      { userId: 'amy', ownerName: 'Amy', isOwn: false, total: 1, hasMore: false, sessions: [session('amy-1', 'Amy iPad')] },
    ];
    await renderPage();

    expect(sectionTitles()).toEqual(['Your sessions · 2', 'Amy · 1']);
    expect(rowNames()).toEqual(['This Mac · This device', 'Phone', 'Amy iPad']);
    // Revoke-others counts only the viewer's own other session, not Amy's.
    expect(container.textContent).toContain('Revoke all other sessions');
  });

  it("loads more of one person's sessions on demand", async () => {
    mocks.groups = [
      OWN_GROUP,
      { userId: 'amy', ownerName: 'Amy', isOwn: false, total: 3, hasMore: true, sessions: [session('amy-1', 'Amy 1'), session('amy-2', 'Amy 2')] },
    ];
    mocks.pages['/api/sessions?userId=amy&skip=2'] = { total: 3, hasMore: false, sessions: [session('amy-3', 'Amy 3')] };
    await renderPage();

    const more = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Show more'))!;
    expect(more.textContent).toContain('Show more (2 of 3)');
    await act(async () => more.click());
    await flush();

    expect(rowNames()).toEqual(['This Mac · This device', 'Phone', 'Amy 1', 'Amy 2', 'Amy 3']);
    expect([...container.querySelectorAll('button')].some((b) => b.textContent?.includes('Show more'))).toBe(false);
  });

  it('hides revoke-others when this is the only own session', async () => {
    mocks.groups = [{ ...OWN_GROUP, total: 1, sessions: [session('current', 'This Mac', true)] }];
    await renderPage();

    expect(sectionTitles()).toEqual(['Your sessions · 1']);
    expect(container.textContent).not.toContain('Revoke all other sessions');
  });
});
