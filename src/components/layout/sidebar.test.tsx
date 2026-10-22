// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ collapsed: true }));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href, 'aria-label': label }: { children: React.ReactNode; href: string; 'aria-label'?: string }) => (
    <a href={href} aria-label={label}>{children}</a>
  ),
}));
vi.mock('@/components/layout/navigation-provider', () => ({ usePendingHref: () => null }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => null, hasCapability: () => true }));
vi.mock('@/components/search/search-store', () => ({ useSearchPalette: () => () => {} }));
vi.mock('@/components/layout/badge-provider', () => ({ useBadgeCounts: () => ({}) }));
vi.mock('@/components/layout/nav-badge', () => ({ NavBadge: () => null }));
vi.mock('@/lib/nav-config', () => ({
  getEnabledNavItems: () => [
    { href: '/dashboard', label: 'Dashboard', icon: () => null },
    { href: '/movies', label: 'Movies', icon: () => null },
  ],
  navItemAllowed: () => true,
  getActiveNavHref: () => '/dashboard',
}));
vi.mock('@/lib/store', () => ({
  useUIStore: (select: (s: Record<string, unknown>) => unknown) => select({
    sidebarCollapsed: mocks.collapsed, toggleSidebar: () => {}, navOrder: [], disabledNavItems: [],
  }),
}));
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sidebar } from './sidebar';

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(<TooltipProvider><Sidebar /></TooltipProvider>));
const names = () => Array.from(document.querySelectorAll('aside a, aside button'))
  .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '');

describe('Sidebar names', () => {
  it('names every icon-only control when collapsed', async () => {
    mocks.collapsed = true;
    await render();
    expect(names()).toEqual(['Search', 'Dashboard', 'Movies', 'Expand sidebar']);
  });

  it('keeps the visible text as the name when expanded', async () => {
    mocks.collapsed = false;
    await render();
    expect(document.querySelectorAll('aside [aria-label]')).toHaveLength(0);
    expect(names()).toEqual(['Search⌘K', 'Dashboard', 'Movies', 'Collapse']);
  });
});
