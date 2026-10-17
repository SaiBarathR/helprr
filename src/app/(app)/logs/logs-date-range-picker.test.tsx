// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LogsDateRangePicker } from './logs-date-range-picker';

let root: Root;
const render = (from: string, to: string) => act(async () => root.render(
  <LogsDateRangePicker from={from} to={to} onChange={() => {}} />,
));
const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label^="Date range:"]')!;
const times = () => [...document.querySelectorAll('button')]
  .map((b) => b.textContent?.trim() ?? '')
  .filter((t) => /^\d\d:\d\d:\d\d$/.test(t));
const toggle = () => act(async () => trigger().click());

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Desktop layout (a popover).
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('opens on the range applied at that moment', async () => {
  await render('2026-10-01T08:30:00', '2026-10-01T18:45:00');
  await toggle();
  expect(times()).toEqual(['08:30:00', '18:45:00']);
  await toggle();

  // Applied elsewhere while closed.
  await render('2026-10-02T10:00:00', '2026-10-02T11:15:00');
  await toggle();
  expect(times()).toEqual(['10:00:00', '11:15:00']);
});

it('drops an unapplied attempt when it is closed and opened again', async () => {
  await render('2026-10-01T18:45:00', '2026-10-01T08:30:00');
  await toggle();
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Apply')!.click());
  expect(document.body.textContent).toContain('must be before');

  await toggle();
  await toggle();
  expect(document.body.textContent).not.toContain('must be before');
});
