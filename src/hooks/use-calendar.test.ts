// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCalendar } from './use-calendar';

afterEach(() => vi.unstubAllGlobals());

it('refetch reloads the range in the background and settles once the new events are in', async () => {
  let release: () => void = () => {};
  const fetchMock = vi.fn(async () => Response.json([{ id: 'e1' }]));
  vi.stubGlobal('fetch', fetchMock);
  const range = { start: new Date('2026-11-01'), end: new Date('2026-11-30') };
  const { result } = renderHook(() => useCalendar(range));
  await waitFor(() => expect(result.current.loading).toBe(false));

  fetchMock.mockImplementationOnce(() => new Promise((resolve) => {
    release = () => resolve(Response.json([{ id: 'e1' }, { id: 'e2' }]));
  }));
  let settled = false;
  let refetching: Promise<void> = Promise.resolve();
  act(() => { refetching = result.current.refetch().then(() => { settled = true; }); });
  // The views keep showing the old events: no loading flag, no empty flash.
  expect(result.current.loading).toBe(false);
  expect(result.current.events).toHaveLength(1);
  expect(settled).toBe(false);

  await act(async () => { release(); await refetching; });
  expect(settled).toBe(true);
  expect(result.current.events).toHaveLength(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
