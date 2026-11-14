// @vitest-environment jsdom

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  warning: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { warning: mocks.warning, success: mocks.success, error: mocks.error } }));

import {
  ImportWarningsNotice,
  rememberImportNotice,
  rememberImportWarnings,
  showImportWarnings,
  useImportWarnings,
} from '@/components/settings/import-warnings';
import type { ImportWarning } from '@/lib/settings-import/follow-up-tasks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const warnings: ImportWarning[] = [
  { task: 'cleanupSchedulers', message: 'Schedulers did not restart.' },
  { task: 'alertOccurrences', message: 'Alerts unresolved.', alertIds: ['a1', 'a2'] },
];

let root: Root | null = null;
let container: HTMLElement;

function Remembered() {
  const [warnings, setWarnings] = useImportWarnings();
  return <ImportWarningsNotice warnings={warnings} onChange={setWarnings} />;
}

async function renderNotice(strict = false) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(strict ? <StrictMode><Remembered /></StrictMode> : <Remembered />));
}

async function press(label: string) {
  const button = [...container.querySelectorAll('button')].find((el) => el.textContent?.trim() === label);
  if (!button) throw new Error(`no ${label} button`);
  await act(async () => button.click());
}

function respond(status: number, body: unknown) {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
});

describe('warnings remembered across the reload that applies an import', () => {
  it('show in the page once, without a toast', async () => {
    rememberImportWarnings(warnings);
    await renderNotice();

    expect(container.textContent).toContain('Imported, but not all of it is in effect yet');
    expect(container.textContent).toContain('Schedulers did not restart.');
    expect(mocks.warning).not.toHaveBeenCalled();

    act(() => root!.unmount());
    root = null;
    await renderNotice();
    expect(container.textContent).toBe('');
  });

  it('survive Strict Mode running the effect twice', async () => {
    rememberImportWarnings(warnings);
    await renderNotice(true);
    expect(container.textContent).toContain('Schedulers did not restart.');
  });

  it('report when they cannot be kept', () => {
    expect(rememberImportWarnings(warnings)).toBe(true);
    expect(rememberImportWarnings([])).toBe(true);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(rememberImportWarnings(warnings)).toBe(false);
  });

  it('remember nothing when the import had no warnings', async () => {
    rememberImportWarnings([]);
    await renderNotice();
    expect(container.textContent).toBe('');
  });

  it('ignore stored entries that are not import warnings', async () => {
    sessionStorage.setItem('helprr:import-warnings', JSON.stringify([{ task: 'dropDatabase', message: 'x' }, null, 'junk']));
    await renderNotice();
    expect(container.textContent).toBe('');
  });

  it('retry exactly the steps that failed and go away when all are done', async () => {
    rememberImportWarnings(warnings);
    await renderNotice();
    respond(200, { warnings: [] });

    await press('Retry');

    expect(fetch).toHaveBeenCalledWith('/api/settings/import/follow-up', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ tasks: ['cleanupSchedulers', 'alertOccurrences'], alertIds: ['a1', 'a2'] }),
    }));
    expect(mocks.success).toHaveBeenCalledWith('The whole import is in effect now.');
    expect(container.textContent).toBe('');
  });

  it('keep showing what is still not done, and the warnings when the retry fails', async () => {
    rememberImportWarnings(warnings);
    await renderNotice();

    respond(200, { warnings: [warnings[1]] });
    await press('Retry');
    expect(container.textContent).not.toContain('Schedulers did not restart.');
    expect(container.textContent).toContain('Alerts unresolved.');

    respond(403, { error: 'Only admins can retry this' });
    await press('Retry');
    expect(mocks.error).toHaveBeenCalledWith('Only admins can retry this');
    expect(container.textContent).toContain('Alerts unresolved.');
  });

  it('can be dismissed', async () => {
    rememberImportWarnings(warnings);
    await renderNotice();
    await press('Dismiss');
    expect(container.textContent).toBe('');
  });
});

describe('the import result kept across the reload', () => {
  it('shows its toast once after the reload, after the toaster can listen', async () => {
    vi.useFakeTimers();
    try {
      rememberImportNotice({ type: 'success', message: 'Settings imported.' });
      await renderNotice(true);
      // Not in the commit that mounts the page: the root toaster subscribes in it, after the page.
      expect(mocks.success).not.toHaveBeenCalled();
      await act(async () => { vi.runAllTimers(); });
      expect(mocks.success).toHaveBeenCalledTimes(1);
      expect(mocks.success).toHaveBeenCalledWith('Settings imported.');

      act(() => root!.unmount());
      root = null;
      await renderNotice();
      await act(async () => { vi.runAllTimers(); });
      expect(mocks.success).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a notes warning as a warning and ignores a stored value it did not write', async () => {
    vi.useFakeTimers();
    try {
      rememberImportNotice({ type: 'warning', message: 'Imported with notes: x' });
      await renderNotice();
      await act(async () => { vi.runAllTimers(); });
      expect(mocks.warning).toHaveBeenCalledWith('Imported with notes: x');

      act(() => root!.unmount());
      sessionStorage.setItem('helprr:import-notice', JSON.stringify({ type: 'dismiss', message: 'x' }));
      await renderNotice();
      await act(async () => { vi.runAllTimers(); });
      expect(mocks.warning).toHaveBeenCalledTimes(1);
      expect(mocks.success).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is dropped when it was left behind: the page was left before the reload', async () => {
    vi.useFakeTimers();
    try {
      rememberImportNotice({ type: 'success', message: 'Settings imported.' });
      // Back on the Backup page later in the same tab.
      vi.setSystemTime(Date.now() + 11_000);
      await renderNotice();
      await act(async () => { vi.runAllTimers(); });
      expect(mocks.success).not.toHaveBeenCalled();
      expect(sessionStorage.getItem('helprr:import-notice')).toBeNull();

      // Within the reload's window it still shows.
      act(() => root!.unmount());
      rememberImportNotice({ type: 'success', message: 'Settings imported.' });
      vi.setSystemTime(Date.now() + 2_000);
      await renderNotice();
      await act(async () => { vi.runAllTimers(); });
      expect(mocks.success).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not stop the reload when it cannot be kept', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => rememberImportNotice({ type: 'success', message: 'Settings imported.' })).not.toThrow();
  });
});

describe('the toast for a dialog without an owner page', () => {
  it('lists the warnings and stays until dismissed', () => {
    showImportWarnings(warnings);
    expect(mocks.warning).toHaveBeenCalledWith('Imported, but not all of it is in effect yet', expect.objectContaining({ duration: Infinity }));
  });
});
