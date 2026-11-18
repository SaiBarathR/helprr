// @vitest-environment jsdom
import { act, lazy, Suspense, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getQueryClient } from '@/lib/query-client';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

/**
 * "The player's Queue button does nothing on a single film" (Mac re-test of
 * 1.16.0). Rendered with the real provider and the real queue panel:
 * `next/dynamic` is a lazy component here, as it is in the app.
 */
vi.mock('next/dynamic', () => ({
  default: (load: () => Promise<ComponentType<Record<string, unknown>>>) => {
    const Lazy = lazy(async () => ({ default: await load() }));
    return function Dynamic(props: Record<string, unknown>) {
      return <Suspense fallback={null}><Lazy {...props} /></Suspense>;
    };
  },
}));

import { VideoStage } from '../video-stage';

let h: Harness;
const FILM = { ...ITEM, Id: 'film-1', Name: 'Your Name.', Type: 'Movie' } as typeof ITEM;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)', media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // jsdom has no layout; the panel scrolls to the row playing.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  h?.cleanup();
  vi.restoreAllMocks();
  getQueryClient().clear();
});

it('opens the queue panel from the Queue button on a one-film queue', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h = await mountPlayback({
    children: <QueryClientProvider client={client}><VideoStage mediaContainer={document.createElement('div')} /></QueryClientProvider>,
  });
  await h.act(async () => { await h.playback().playItems([FILM]); });
  expect(h.playback().queue).toHaveLength(1);
  expect(h.playback().videoExpanded).toBe(true);

  const queue = document.querySelector('button[aria-label="Queue"]') as HTMLButtonElement | null;
  expect(queue).not.toBeNull();
  await act(async () => { queue!.click(); });
  expect(h.playback().queueOpen).toBe(true);
  // The panel's chunk loads, then it renders.
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(document.querySelector('[data-player-queue]')).not.toBeNull();
  }, { timeout: 5_000 });
  const panel = document.querySelector('[data-player-queue]');
  expect(panel?.textContent).toContain('Your Name.');
});

it('has no Queue button while the controls are hidden, so a tap there only brings them back', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h = await mountPlayback({
    children: <QueryClientProvider client={client}><VideoStage mediaContainer={document.createElement('div')} /></QueryClientProvider>,
  });
  vi.useFakeTimers();
  try {
    await h.act(async () => {
      const start = h.playback().playItems([FILM]);
      await vi.advanceTimersByTimeAsync(0);
      await start;
    });
    expect(h.playback().status).toBe('playing');
    expect(document.querySelector('button[aria-label="Queue"]')).not.toBeNull();
    // The controls hide 3.5 s into playback.
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(document.querySelector('button[aria-label="Queue"]')).toBeNull();
    expect(h.playback().queueOpen).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
