// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ me: null as null | { role: string; capabilities: Record<string, boolean> } }));
vi.mock('@/components/permission-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/permission-provider')>()),
  useMe: () => mocks.me,
}));
vi.mock('@/lib/widgets/use-widget-data', () => ({
  useWidgetData: () => ({ data: { totalMovies: 10, totalSeries: 5, activeDownloads: 0 }, loading: false }),
}));
vi.mock('@/lib/widgets/use-element-size', () => ({ useElementSize: () => ({ ref: { current: null }, width: 600, height: 300 }) }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { StatsGridWidget } from './stats-grid-widget';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const links = () => [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('StatsGridWidget', () => {
  it('links a tile only to a page the member may open', () => {
    mocks.me = { role: 'member', capabilities: { 'movies.view': true, 'series.view': true, 'activity.view': false } };
    act(() => root.render(<StatsGridWidget refreshInterval={30_000} />));
    expect(links()).toEqual(['/movies', '/series']);
    expect(container.textContent).toContain('Downloading');
  });

  it('links every tile for an admin', () => {
    mocks.me = { role: 'admin', capabilities: {} };
    act(() => root.render(<StatsGridWidget refreshInterval={30_000} />));
    expect(links()).toEqual(['/movies', '/series', '/activity']);
  });
});
