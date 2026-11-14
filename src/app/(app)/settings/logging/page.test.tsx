// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn(), toastError: vi.fn(), role: 'admin' as 'admin' | 'member' }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => ({ role: mocks.role }) }));
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
  mocks.role = 'admin';
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

const bodySwitches = () => ['Failed Request Bodies', 'Failed Response Bodies']
  .map((label) => document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement);

it('gives an admin every switch and Delete all log files', () => {
  expect(deleteButton().disabled).toBe(false);
  expect(bodySwitches().map((s) => s.disabled)).toEqual([false, false]);
  expect(document.body.textContent).not.toContain('Only an admin can');
});

it('a member with this page gets Delete all log files, and the body switches off with the reason', async () => {
  // The page itself needs "Logging settings"; the server takes it for Delete all
  // log files and refuses the body switches from anyone but an admin.
  mocks.role = 'member';
  mocks.update.mockResolvedValue({ logEnabled: false, logClientConsoleEnabled: false });
  await render();

  expect(deleteButton().disabled).toBe(false);
  expect(bodySwitches().map((s) => s.disabled)).toEqual([true, true]);
  expect(document.body.textContent).toContain('Only an admin can turn failed request and response bodies on or off.');
  const consoleSwitch = document.querySelector('[aria-label="Client Console Logging"]') as HTMLButtonElement;
  expect(consoleSwitch.disabled).toBe(false);

  // Turning logging off still offers to delete the files on disk.
  const toggle = document.querySelector('[aria-label="Enable Logging"]') as HTMLButtonElement;
  await act(async () => toggle.click());
  expect(mocks.update).toHaveBeenCalledWith({ logEnabled: false });
  expect(document.body.textContent).toContain('Delete log files on disk?');
});

it('offers an admin to delete the files after turning logging off', async () => {
  mocks.update.mockResolvedValue({ logEnabled: false, logClientConsoleEnabled: false });
  const toggle = document.querySelector('[aria-label="Enable Logging"]') as HTMLButtonElement;
  await act(async () => toggle.click());
  expect(document.body.textContent).toContain('Delete log files on disk?');
});

it.each([
  ['log-max-file-mb', '0'],
  ['log-retention-days', '5000'],
])('%s: an invalid draft stays as typed, with no toast, when the app is only switched away from', async (id, invalid) => {
  await type(input(id), invalid);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  visibility.mockRestore();

  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.toastError).not.toHaveBeenCalled();
  expect(input(id).value).toBe(invalid);
});
