// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn(), toastError: vi.fn() }));
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

beforeEach(async () => {
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

  expect(mocks.update).toHaveBeenCalledWith({ logMaxFileMb: 200 });
  root = createRoot(document.getElementById('root')!);
});
