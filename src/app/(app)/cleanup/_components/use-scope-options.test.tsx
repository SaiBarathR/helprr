// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getQueryClient } from '@/lib/query-client';
import { useScopeOptions } from './use-scope-options';

// The app's own client, so the hook is held to the app's retry rule.
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;

afterEach(() => {
  getQueryClient().clear();
  vi.unstubAllGlobals();
});

describe('useScopeOptions', () => {
  it('reads the suggestions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ qbitCategories: ['tv'], qbitTags: ['x'], trackerDomains: ['t.example'] })));
    const { result } = renderHook(() => useScopeOptions(), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ categories: ['tv'], tags: ['x'], trackerDomains: ['t.example'] }));
  });

  it('does not ask again after a refusal, and offers no suggestions', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useScopeOptions(), { wrapper });
    await waitFor(() => expect(getQueryClient().getQueryState(['cleanup', 'scope-options'])?.status).toBe('error'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.categories).toEqual([]);
  });

  it('asks once more after a server error', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useScopeOptions(), { wrapper });
    await waitFor(() => expect(getQueryClient().getQueryState(['cleanup', 'scope-options'])?.status).toBe('error'), { timeout: 4_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
