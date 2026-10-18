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
        renderTrigger={(t) => <button type="button" aria-label={t.label} aria-expanded={t.open} onClick={t.onClick}>{t.rating ?? 'none'}</button>}
      />
    </QueryClientProvider>,
  ));
  return client;
}
// A few macrotasks: the mocked fetch's Response body resolves over more than one.
const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); });
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

  it('refreshes the recommendation rails, the Watch rails and the Excluded list after a save', async () => {
    const client = render();
    await flush();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    act(() => byLabel('Rate The Matrix')!.click());
    act(() => byLabel('Not for me')!.click());
    await flush();
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys).toEqual(expect.arrayContaining([
      '["recommendations-excluded"]', '["recommendations-excluded-count"]', '["jellyfin","catalog","recommendation-rails"]',
    ]));
    expect(invalidate.mock.calls.every(([filters]) => filters?.refetchType === undefined)).toBe(true);
    const predicates = invalidate.mock.calls.map(([filters]) => filters?.predicate).filter(Boolean);
    const matches = (queryKey: unknown[]) => predicates.some((predicate) => predicate!({ queryKey } as never));
    // The recommendation rails, but not other titles' ratings (one may have its own save pending).
    expect(matches(['recommendations', 'rails'])).toBe(true);
    expect(matches(['recommendations', 'rating', 'tmdb:movie:1'])).toBe(false);
    // The dashboard's For You widget too.
    expect(matches(['widget-data', 'for-you-12'])).toBe(true);
    expect(matches(['widget-data', 'calendar'])).toBe(false);
  });

  it('sends a second choice only after the first has been saved, and keeps showing it meanwhile', async () => {
    let release!: () => void;
    let releaseSecond!: () => void;
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ rating: null })));
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = () => { stored = 'up'; resolve(new Response('{}')); }; }));
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseSecond = () => { stored = 'down'; resolve(new Response('{}')); }; }));
    render();
    await flush();
    act(() => byLabel('Rate The Matrix')!.click());
    act(() => byLabel('I like this')!.click());
    await flush();
    act(() => byLabel('Rated The Matrix: I like this')!.click());
    act(() => byLabel('Not for me')!.click());
    await flush();
    const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT').length;
    expect(puts()).toBe(1);
    await act(async () => { release(); });
    await flush();
    expect(puts()).toBe(2);
    // The first save's refetch must not show its older rating over the queued choice.
    expect(byLabel('Rated The Matrix: Not for me')).not.toBeNull();
    await act(async () => { releaseSecond(); });
    await flush();
    expect(byLabel('Rated The Matrix: Not for me')).not.toBeNull();
  });

  it('stays open when focus goes nowhere, as Safari does on a tap, so the tap still saves', async () => {
    render();
    await flush();
    act(() => byLabel('Rate The Matrix')!.click());
    const option = byLabel('I like this')!;
    act(() => { option.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })); });
    expect(byLabel('I like this')).not.toBeNull();
    act(() => byLabel('I like this')!.click());
    await flush();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true);
  });

  it('closes when focus leaves it, and then leaves Escape to whatever has focus', async () => {
    render();
    await flush();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const outer = vi.fn();
    outside.addEventListener('keydown', outer);
    act(() => byLabel('Rate The Matrix')!.click());
    expect(byLabel('I like this')).not.toBeNull();
    act(() => outside.focus());
    expect(byLabel('I like this')).toBeNull();
    act(() => { outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(outer).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('opens on the pressed choice, and Escape closes only the menu', async () => {
    stored = 'up';
    render();
    await flush();
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    act(() => byLabel('Rated The Matrix: I like this')!.click());
    expect(byLabel('Rated The Matrix: I like this')!.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(byLabel('I like this'));
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    document.removeEventListener('keydown', outer);
    expect(outer).not.toHaveBeenCalled();
    expect(byLabel('I like this')).toBeNull();
    const trigger = byLabel('Rated The Matrix: I like this')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('shows the saved rating again after a failed save from a closed tile menu', async () => {
    stored = 'up';
    render(true);
    await flush();
    act(() => byLabel('Rate The Matrix')!.click());
    await flush();
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 500 }));
    act(() => byLabel('Love this!')!.click());
    await flush();
    // The menu closed (the lazy query is now idle), the save failed, and the
    // server still has "I like this".
    expect(byLabel('Love this!')).toBeNull();
    expect(byLabel('Rated The Matrix: I like this')).not.toBeNull();
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
