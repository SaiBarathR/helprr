// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useArrInstanceId } from '../use-arr-instance-id';

const fetchMock = vi.fn(async () => Response.json([
  { id: 'son-main', type: 'SONARR', isDefault: true },
  { id: 'rad-4k', type: 'RADARR', isDefault: false },
  { id: 'rad-main', type: 'RADARR', isDefault: true },
]));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useArrInstanceId', () => {
  it("uses the page's ?instance= without asking", () => {
    const { result } = renderHook(() => useArrInstanceId('RADARR', 'rad-4k'), { wrapper });
    expect(result.current).toBe('rad-4k');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the type's default instance", async () => {
    const { result } = renderHook(() => useArrInstanceId('RADARR', undefined), { wrapper });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe('rad-main'));
    expect(fetchMock).toHaveBeenCalledWith('/api/instances', expect.anything());
  });
});
