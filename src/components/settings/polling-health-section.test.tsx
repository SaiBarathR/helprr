// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PollingHealthSection } from './polling-health-section';

let container: HTMLDivElement;
let root: Root;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function render(health: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(health))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => root.render(<QueryClientProvider client={client}><PollingHealthSection /></QueryClientProvider>));
  for (let i = 0; i < 20 && !container.textContent; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('PollingHealthSection', () => {
  it('shows the cycle and names a failing and a stuck job', async () => {
    await render({
      running: true, intervalMs: 30000, cycleInProgress: false,
      lastCycle: { finishedAt: minutesAgo(0.2), durationMs: 1840, failed: 1 },
      sources: [
        { source: 'pollSonarr', lastSuccessAt: minutesAgo(0.2), lastFailureAt: null, lastError: null, runningSince: null },
        { source: 'pollSeerr', lastSuccessAt: minutesAgo(10), lastFailureAt: minutesAgo(0.2), lastError: 'Request timed out', runningSince: null },
        { source: 'pollJellyfin', lastSuccessAt: minutesAgo(30), lastFailureAt: null, lastError: null, runningSince: minutesAgo(12) },
      ],
    });
    expect(container.textContent).toContain('Running every 30 s');
    expect(container.textContent).toContain('in 1.8 s, 1 failed');
    expect(container.textContent).toContain('Seerr');
    expect(container.textContent).toContain('Request timed out');
    expect(container.textContent).toContain('Jellyfin');
    expect(container.textContent).toContain('Still running, started');
    expect(container.textContent).not.toContain('Sonarr');
  });

  it('lists no jobs when all is well, and says when polling is stopped', async () => {
    await render({ running: false, intervalMs: null, cycleInProgress: false, lastCycle: null, sources: [
      { source: 'pollSeerr', lastSuccessAt: minutesAgo(1), lastFailureAt: minutesAgo(5), lastError: 'old', runningSince: null },
    ] });
    expect(container.textContent).toContain('Stopped');
    expect(container.textContent).toContain('No cycle has finished yet.');
    expect(container.textContent).not.toContain('Seerr');
  });
});
