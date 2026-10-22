// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), canGoBack: true }));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ push: mocks.push, replace: vi.fn(), back: mocks.back }),
  canGoBackInApp: () => mocks.canGoBack,
}));
import { PageHeader } from './page-header';

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.canGoBack = true;
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

  it('keeps a custom onBack', async () => {
    const onBack = vi.fn();
    await pressBack({ title: 'Edit', onBack, backHref: '/series' });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(mocks.back).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
