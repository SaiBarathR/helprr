// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 72,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 72,
      })),
    measureElement: vi.fn(),
    options: { scrollMargin: 0 },
  }),
}));
vi.mock('@/components/layout/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => title,
}));
vi.mock('@/components/media/person-row', () => ({
  PersonRow: ({ name }: { name: string }) => name,
}));
vi.mock('@/components/ui/page-spinner', () => ({
  PageSpinner: () => 'Loading',
}));

import { CreditsListPage, type CreditPerson } from './credits-list-page';

const cast: CreditPerson[] = [{
  id: 1,
  name: 'Cached Person',
  imagePath: null,
  role: 'Lead',
}];

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

function renderCredits(overrides: Partial<Parameters<typeof CreditsListPage>[0]> = {}) {
  return act(async () => {
    root.render(createElement(CreditsListPage, {
      mediaTitle: 'Example',
      cast: [],
      crew: [],
      cacheService: 'tmdb',
      ...overrides,
    }));
  });
}

describe('CreditsListPage query states', () => {
  it('renders a retryable initial error instead of empty credits', async () => {
    const onRetry = vi.fn();
    await renderCredits({
      errorMessage: "Couldn't load credits. Try again.",
      onRetry,
    });

    expect(document.body.textContent).toContain("Couldn't load credits. Try again.");
    expect(document.body.textContent).not.toContain('No cast credits found');

    const retry = [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Retry'));
    await act(async () => {
      retry?.click();
    });
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps usable credits visible when no initial error is supplied', async () => {
    await renderCredits({ cast });

    expect(document.body.textContent).toContain('Cached Person');
    expect(document.body.textContent).not.toContain("Couldn't load credits");
  });

  it('preserves the successful empty state', async () => {
    await renderCredits();

    expect(document.body.textContent).toContain('No cast credits found');
  });

  it('disables retry while a request is in flight', async () => {
    await renderCredits({
      errorMessage: "Couldn't load credits. Try again.",
      onRetry: vi.fn(),
      retrying: true,
    });

    const retry = [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Retry'));
    expect(retry?.disabled).toBe(true);
  });
});
