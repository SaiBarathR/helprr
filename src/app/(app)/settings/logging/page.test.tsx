// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn(), toastError: vi.fn(), caps: new Set<string>(['logs.manage']) }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/hooks/use-app-settings', () => ({
  useAppSettings: () => ({
    settings: { logEnabled: true, logClientConsoleEnabled: false, logLevel: 'info', logMaxFileMb: 50, logRetentionDays: 30 },
    loading: false,
    update: mocks.update,
  }),
}));

import LoggingSettingsPage from './page';

let root: Root;
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const type = (el: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
// React's onBlur listens for focusout.
const blur = (el: HTMLInputElement) => act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });

const render = async () => {
  await act(async () => root.unmount());
  root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(<LoggingSettingsPage />));
};
const deleteButton = () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete all log files')!;

beforeEach(async () => {
  mocks.caps = new Set(['logs.manage']);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(<LoggingSettingsPage />));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

it.each([
  ['log-max-file-mb', '0', 'Rotate at must be between 1 and 1024 MB', '50'],
  ['log-retention-days', '5000', 'Retention must be between 1 and 3650 days', '30'],
])('%s: an invalid draft is dropped silently when the page unmounts', async (id, invalid) => {
  await type(input(id), invalid);
  await act(async () => root.unmount());

  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.toastError).not.toHaveBeenCalled();
  root = createRoot(document.getElementById('root')!);
});

it.each([
  ['log-max-file-mb', '0', 'Rotate at must be between 1 and 1024 MB', '50'],
  ['log-retention-days', '5000', 'Retention must be between 1 and 3650 days', '30'],
])('%s: an invalid draft on blur says why and goes back to the saved value', async (id, invalid, message, saved) => {
  await type(input(id), invalid);
  await blur(input(id));

  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.toastError).toHaveBeenCalledWith(message);
  expect(input(id).value).toBe(saved);
});

it('commits a valid draft when the page unmounts', async () => {
  await type(input('log-max-file-mb'), '200');
  await act(async () => root.unmount());

  expect(mocks.update).toHaveBeenCalledWith({ logMaxFileMb: 200 }, undefined);
  root = createRoot(document.getElementById('root')!);
});

it('sends a pending draft with keepalive when the page hides (a reload, a Back out)', async () => {
  await type(input('log-max-file-mb'), '200');
  await act(async () => { window.dispatchEvent(new Event('pagehide')); });

  expect(mocks.update).toHaveBeenCalledTimes(1);
  expect(mocks.update).toHaveBeenCalledWith({ logMaxFileMb: 200 }, { keepalive: true });
});

it('sends a pending draft with keepalive when the app goes to the background', async () => {
  await type(input('log-retention-days'), '45');
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  visibility.mockRestore();

  expect(mocks.update).toHaveBeenCalledWith({ logRetentionDays: 45 }, { keepalive: true });
  // Nothing left to send on unmount.
  await act(async () => root.unmount());
  expect(mocks.update).toHaveBeenCalledTimes(1);
  root = createRoot(document.getElementById('root')!);
});

it('offers Delete all log files with logs.manage', () => {
  expect(deleteButton().disabled).toBe(false);
  expect(document.body.textContent).not.toContain('needs “Delete logs”');
});

it('without logs.manage, says why Delete all log files is off and never offers it after turning logging off', async () => {
  // A member given only the Logging page: DELETE /api/logs/files would answer Forbidden.
  mocks.caps = new Set(['settings.logging']);
  mocks.update.mockResolvedValue({ logEnabled: false, logClientConsoleEnabled: false });
  await render();

  expect(deleteButton().disabled).toBe(true);
  expect(document.body.textContent).toContain('Deleting log files needs “Delete logs”');

  const toggle = document.querySelector('[aria-label="Enable Logging"]') as HTMLButtonElement;
  await act(async () => toggle.click());
  expect(mocks.update).toHaveBeenCalledWith({ logEnabled: false });
  expect(document.body.textContent).not.toContain('Delete log files on disk?');
});

it('with logs.manage, offers to delete the files after turning logging off', async () => {
  mocks.update.mockResolvedValue({ logEnabled: false, logClientConsoleEnabled: false });
  const toggle = document.querySelector('[aria-label="Enable Logging"]') as HTMLButtonElement;
  await act(async () => toggle.click());
  expect(document.body.textContent).toContain('Delete log files on disk?');
});
