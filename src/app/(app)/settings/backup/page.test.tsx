// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportWarning } from '@/lib/settings-import/follow-up-tasks';

const mocks = vi.hoisted(() => ({
  onImported: null as null | ((warnings: ImportWarning[]) => void),
}));

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/settings/export-settings-dialog', () => ({ ExportSettingsDialog: () => null }));
vi.mock('@/components/settings/import-settings-dialog', () => ({
  ImportSettingsDialog: ({ onImported }: { onImported: (warnings: ImportWarning[]) => void }) => {
    mocks.onImported = onImported;
    return null;
  },
}));

import BackupSettingsPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const warnings: ImportWarning[] = [{ task: 'cleanupSchedulers', message: 'Schedulers did not restart.' }];
let root: Root;
let container: HTMLElement;

beforeEach(async () => {
  sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<BackupSettingsPage />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const reloadsScheduled = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([, delay]) => delay === 600).length;

describe('backup page after an import', () => {
  it('keeps the warnings across the reload that applies the import', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

    await act(async () => mocks.onImported!(warnings));

    expect(reloadsScheduled(setTimeoutSpy)).toBe(1);
    expect(JSON.parse(sessionStorage.getItem('helprr:import-warnings') ?? '[]')).toEqual(warnings);
  });

  it('stays on the page and shows the warnings when they cannot be kept', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });

    await act(async () => mocks.onImported!(warnings));

    expect(reloadsScheduled(setTimeoutSpy)).toBe(0);
    expect(container.textContent).toContain('Schedulers did not restart.');
  });
});
