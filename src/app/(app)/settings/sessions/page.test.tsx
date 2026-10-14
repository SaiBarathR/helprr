// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  clearCaches: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('@/lib/client-cache', () => ({
  clearUserScopedBrowserCaches: () => {
    mocks.events.push('clear browser caches');
    return mocks.clearCaches();
  },
  broadcastAuthenticationBoundary: () => mocks.events.push('broadcast'),
}));
vi.mock('@/lib/query-client', () => ({
  getQueryClient: () => ({ clear: () => mocks.events.push('clear query client') }),
  holdLoginRedirect: () => mocks.events.push('hold login redirect'),
}));
vi.mock('@/lib/hooks/use-external-urls', () => ({
  invalidateExternalUrls: () => mocks.events.push('invalidate external urls'),
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><SessionsPage /></QueryClientProvider>);
  });
  await flush();
}

function button(label: string) {
  const match = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!match) throw new Error(`No button "${label}"`);
  return match;
}

async function revoke(rowButton: 'Sign out' | 'Revoke') {
  const rows = [...container.querySelectorAll('button')].filter((b) => b.textContent?.trim() === rowButton);
  await act(async () => rows[0].click());
  const confirm = container.querySelector<HTMLButtonElement>('[data-confirm]')!;
  await act(async () => confirm.click());
  await flush();
}

beforeEach(() => {
  mocks.events = [];
  mocks.clearCaches.mockReset().mockResolvedValue(undefined);
  mocks.replace.mockReset().mockImplementation(() => mocks.events.push('navigate to /login'));
  vi.stubGlobal('location', { ...window.location, replace: mocks.replace });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/sessions') return Response.json(SESSIONS);
    if (init?.method === 'POST' && url.endsWith('/revoke')) {
      return Response.json({ wasCurrent: url.includes('/current/') });
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
  it('clears this browser before Login when the current session is revoked', async () => {
    await renderPage();
    await revoke('Sign out');

    expect(mocks.events).toEqual([
      'hold login redirect',
      'clear query client',
      'invalidate external urls',
      'broadcast',
      'clear browser caches',
      'navigate to /login',
    ]);
    expect(container.textContent).toContain('Securing this browser session');
  });

  it('stays on an error screen and does not navigate when the clear fails', async () => {
    mocks.clearCaches.mockRejectedValue(new Error('cache delete timed out'));
    await renderPage();
    await revoke('Sign out');

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Browser data could not be cleared');
  });

  it('clears nothing when another session is revoked', async () => {
    await renderPage();
    await revoke('Revoke');

    expect(mocks.events).toEqual([]);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(button('Sign out')).toBeTruthy();
  });
});
