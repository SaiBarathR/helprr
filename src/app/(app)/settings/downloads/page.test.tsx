// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BandwidthRule } from '@/lib/bandwidth-scheduler/types';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));

import DownloadsSettingsPage from './page';

const rule: BandwidthRule = {
  id: 'rule-1', name: 'Evenings', enabled: true, daysOfWeek: [1, 2, 3, 4, 5],
  startHour: 18, startMinute: 0, endHour: 23, endMinute: 0, downloadLimitKbps: 5000, uploadLimitKbps: 1000,
};
let root: Root;

const nameInput = () => document.querySelector<HTMLInputElement>('input[placeholder="Rule name"]')!;
const unsaved = () => document.body.textContent?.includes('Unsaved changes') ?? false;
// Types into a controlled input the way a user does.
const type = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ schedule: { rules: [rule] }, timeZone: 'UTC', activeRuleId: null }),
    { status: 200 },
  )));
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DownloadsSettingsPage />
    </QueryClientProvider>,
  ));
  await vi.waitFor(() => expect(nameInput()?.value).toBe('Evenings'));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('is dirty after an edit and clean again once the edit is reverted', async () => {
  expect(unsaved()).toBe(false);

  await type(nameInput(), 'Evenings and weekends');
  expect(unsaved()).toBe(true);

  await type(nameInput(), 'Evenings');
  expect(unsaved()).toBe(false);
});
