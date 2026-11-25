// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useCalendarMonitoredDefault } from '@/lib/hooks/use-calendar-monitored-default';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

afterEach(() => {
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

it("reads the user's saved default", async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ calendarMonitoredOnly: true }), { status: 200 })));
  const { result } = renderHook(() => useCalendarMonitoredDefault(), { wrapper });
  expect(result.current.pending).toBe(true);
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(result.current.monitoredOnly).toBe(true);
});

it('does not hold the page while offline, when the query pauses instead of failing', () => {
  onlineManager.setOnline(false);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useCalendarMonitoredDefault(), { wrapper });
  expect(result.current).toEqual({ monitoredOnly: false, pending: false });
  expect(fetchMock).not.toHaveBeenCalled();
});
