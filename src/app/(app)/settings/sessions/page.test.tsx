// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  endSession: vi.fn(),
  revokeResponse: null as null | (() => void),
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

const SESSIONS = [
  { id: 'current', label: 'This Mac', userAgent: null, ip: null, createdAt: '2026-10-01T00:00:00Z', lastSeenAt: null, isCurrent: true },
  { id: 'other', label: 'Phone', userAgent: null, ip: null, createdAt: '2026-10-01T00:00:00Z', lastSeenAt: null, isCurrent: false },
];

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

async function confirmRevoke(rowButton: 'Sign out' | 'Revoke') {
  const rows = [...container.querySelectorAll('button')].filter((b) => b.textContent?.trim() === rowButton);
  await act(async () => rows[0].click());
  await act(async () => container.querySelector<HTMLButtonElement>('[data-confirm]')!.click());
}

beforeEach(() => {
  mocks.endSession.mockReset();
  mocks.revokeResponse = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/sessions') return Response.json(SESSIONS);
    if (init?.method === 'POST' && url.endsWith('/revoke')) {
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
    await confirmRevoke('Sign out');
    await flush();

    expect(mocks.endSession).toHaveBeenCalledOnce();
  });

  it('still ends this browser session when the page was left before the response', async () => {
    mocks.revokeResponse = () => undefined;
    await renderPage();
    await confirmRevoke('Sign out');
    act(() => root.unmount());
    await act(async () => mocks.revokeResponse?.());
    await flush();

    expect(mocks.endSession).toHaveBeenCalledOnce();
    root = createRoot(container);
  });

  it('leaves this browser alone when another session is revoked', async () => {
    await renderPage();
    await confirmRevoke('Revoke');
    await flush();

    expect(mocks.endSession).not.toHaveBeenCalled();
  });
});
