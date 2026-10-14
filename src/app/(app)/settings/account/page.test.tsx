// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  endSession: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/client-cache', () => ({
  requestSessionLogout: mocks.logout,
  endSessionInThisBrowser: mocks.endSession,
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/settings/jellyfin-connection', () => ({ JellyfinConnection: () => null }));

import AccountSettingsPage from './page';

let root: Root;
let container: HTMLElement;

async function signOut() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<AccountSettingsPage />));
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Sign out'))!;
  await act(async () => button.click());
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Account sign-out', () => {
  it.each(['success', 'indeterminate'] as const)('ends this browser session after a %s logout', async (result) => {
    mocks.logout.mockResolvedValue(result);
    await signOut();
    expect(mocks.endSession).toHaveBeenCalledOnce();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('keeps the session and reports a failed logout', async () => {
    mocks.logout.mockResolvedValue('failed');
    await signOut();
    expect(mocks.endSession).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('Failed to sign out');
  });
});
