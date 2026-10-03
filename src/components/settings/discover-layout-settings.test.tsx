// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  layout: {
    sections: [
      { id: 'trending', type: 'builtin', label: 'Trending', enabled: true },
      {
        id: 'custom_1',
        type: 'custom',
        label: 'Horror 2020s',
        enabled: true,
        filters: { contentType: 'movie', sortBy: 'popular', sortOrder: 'desc', genres: [27] },
      },
    ],
  },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/appearance/discover-layout',
  useSearchParams: () => mocks.search,
}));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ push: mocks.push, replace: mocks.replace, back: mocks.back }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { layout: mocks.layout, filtersMeta: null }, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/language-region-combobox', () => ({ LanguageRegionCombobox: () => null }));
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children }: { children: React.ReactNode }) => children,
}));

import { DiscoverLayoutSettings } from './discover-layout-settings';

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.push.mockClear();
  mocks.replace.mockClear();
  mocks.back.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

async function render(query: string) {
  mocks.search = new URLSearchParams(query);
  await act(async () => root.render(<DiscoverLayoutSettings />));
}

const button = (label: string) => [...document.querySelectorAll('button')].find(
  (el) => el.getAttribute('aria-label') === label || el.textContent?.trim() === label,
);

describe('Discover layout custom carousel editor', () => {
  it('opens the editor as a page on the same route', async () => {
    await render('');
    await act(async () => button('Edit custom carousel')?.click());

    expect(mocks.push).toHaveBeenCalledWith('/settings/appearance/discover-layout?carousel=custom_1');
  });

  it('keeps an edit in the unsaved layout and goes back to the list', async () => {
    await render('');
    await act(async () => button('Edit custom carousel')?.click());
    // The route now carries ?carousel; the component stays mounted.
    await render('carousel=custom_1');
    const name = document.querySelector<HTMLInputElement>('input[placeholder^="e.g."]')!;
    expect(name.value).toBe('Horror 2020s');

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(name, 'Horror 2010s');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Update')?.click());
    expect(mocks.back).toHaveBeenCalledOnce();

    await render('');
    expect(document.body.textContent).toContain('Horror 2010s');
    expect(button('Save')?.hasAttribute('disabled')).toBe(false);
  });

  it('still pops the history entry after Forward back into the editor', async () => {
    await render('');
    await act(async () => button('Edit custom carousel')?.click());
    await render('carousel=custom_1');
    await act(async () => button('Cancel')?.click());
    await render('');
    // Browser Forward returns to the editor entry.
    await render('carousel=custom_1');
    await act(async () => button('Cancel')?.click());

    expect(mocks.back).toHaveBeenCalledTimes(2);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('replaces the route when the editor was opened directly', async () => {
    await render('carousel=new');
    expect(document.body.textContent).toContain('New Custom Carousel');

    await act(async () => button('Cancel')?.click());
    expect(mocks.replace).toHaveBeenCalledWith('/settings/appearance/discover-layout');
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it('says so when the carousel is not in the layout', async () => {
    await render('carousel=custom_missing');
    expect(document.body.textContent).toContain("isn't in your layout any more");
  });
});
