// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  canGoBack: true,
  me: { role: 'admin', capabilities: {} } as { role: 'admin' | 'member'; capabilities: Record<string, boolean> },
}));
vi.mock('@/components/permission-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/permission-provider')>()),
  useMe: () => mocks.me,
}));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ push: mocks.push, replace: vi.fn(), back: mocks.back }),
  canGoBackInApp: () => mocks.canGoBack,
}));
import { PageHeader } from './page-header';
import { useUIStore } from '@/lib/store';

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.canGoBack = true;
  mocks.me = { role: 'admin', capabilities: {} };
  useUIStore.getState().resetNavConfig();
  window.history.replaceState(null, '', '/series/1');
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

async function pressBack(props: Parameters<typeof PageHeader>[0]) {
  await act(async () => root.render(<PageHeader {...props} />));
  await act(async () => (document.querySelector('[aria-label="Go back"]') as HTMLButtonElement).click());
}

describe('PageHeader Back', () => {
  it('returns to the previous page even when a parent page is given', async () => {
    await pressBack({ title: 'Ted Lasso', backHref: '/series' });
    expect(mocks.back).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('opens the parent page when there is no earlier page, as after a deep link', async () => {
    mocks.canGoBack = false;
    await pressBack({ title: 'Ted Lasso', backHref: '/series' });
    expect(mocks.push).toHaveBeenCalledWith('/series');
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it('returns to the previous page when no parent page is given', async () => {
    window.history.replaceState(null, '', '/movies/486');
    await pressBack({ title: 'Dune' });
    expect(mocks.back).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each([
    ['/movies/486', '/movies'],
    ['/movies/486/files', '/movies'],
    ['/discover/movie/123', '/discover'],
    ['/activity/history', '/activity'],
    ['/jellyfin/library/abc', '/jellyfin/library'],
    ['/notifications', '/dashboard'],
    ['/unknown/page', '/dashboard'],
  ])('without an earlier page or a parent page, Back on %s opens %s', async (pathname, expected) => {
    mocks.canGoBack = false;
    window.history.replaceState(null, '', pathname);
    await pressBack({ title: 'Detail' });
    expect(mocks.push).toHaveBeenCalledWith(expected);
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it('prefers the given parent page over the nav section', async () => {
    mocks.canGoBack = false;
    window.history.replaceState(null, '', '/movies/486');
    await pressBack({ title: 'Dune', backHref: '/calendar' });
    expect(mocks.push).toHaveBeenCalledWith('/calendar');
  });

  it("skips a section the user can't open and opens their default page instead", async () => {
    mocks.canGoBack = false;
    mocks.me = { role: 'member', capabilities: { 'movies.view': true } };
    useUIStore.getState().setDefaultPage('movies');
    window.history.replaceState(null, '', '/discover/movie/550');
    await pressBack({ title: 'Fight Club' });
    expect(mocks.push).toHaveBeenCalledWith('/movies');
  });

  it('keeps a custom onBack', async () => {
    const onBack = vi.fn();
    await pressBack({ title: 'Edit', onBack, backHref: '/series' });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(mocks.back).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
