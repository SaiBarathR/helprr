// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ canRate: true }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => mocks.canRate }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { RateControl } from './rate-control';

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let stored: string | null;

function render(lazy = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => root.render(
    <QueryClientProvider client={client}>
      <RateControl
        itemKey="tmdb:movie:603"
        title="The Matrix"
        genres={['Action', 'Science Fiction']}
        lazy={lazy}
        renderTrigger={(t) => <button type="button" aria-label={t.label} onClick={t.onClick}>{t.rating ?? 'none'}</button>}
      />
    </QueryClientProvider>,
  ));
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const byLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.canRate = true;
  stored = null;
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      stored = JSON.parse(String(init.body)).rating;
      return new Response(JSON.stringify({ rating: stored }));
    }
    return new Response(JSON.stringify({ rating: stored }));
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('RateControl', () => {
  it('saves a rating with the title\'s genres and shows it as pressed', async () => {
    render();
    await flush();
    act(() => byLabel('Rate The Matrix')!.click());
    act(() => byLabel('Love this!')!.click());
    await flush();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(put[1].body))).toEqual({ itemKey: 'tmdb:movie:603', rating: 'love', genres: ['Action', 'Science Fiction'] });
    expect(byLabel('Rated The Matrix: Love this!')).not.toBeNull();
    act(() => byLabel('Rated The Matrix: Love this!')!.click());
    expect(byLabel('Love this!')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('clears the rating when the pressed choice is chosen again', async () => {
    stored = 'up';
    render();
    await flush();
    act(() => byLabel('Rated The Matrix: I like this')!.click());
    act(() => byLabel('I like this')!.click());
    await flush();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(put[1].body)).rating).toBeNull();
    expect(byLabel('Rate The Matrix')).not.toBeNull();
  });

  it('reads nothing until a lazy control is opened', async () => {
    render(true);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => byLabel('Rate The Matrix')!.click());
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/recommendations/rating?itemKey=tmdb%3Amovie%3A603', expect.anything());
  });

  it('is absent without the recommendations capability', () => {
    mocks.canRate = false;
    render();
    expect(container.querySelector('button')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
