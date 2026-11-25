// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  instances: [] as Array<{ id: string; label: string; isDefault: boolean }>,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ replace: mocks.replace }) }));

import { useUIStore } from '@/lib/store';
import { useQbitInstance } from './use-qbit-instance';

const INSTANCES = [
  { id: 'q1', label: 'Main', isDefault: true },
  { id: 'q2', label: 'Seedbox', isDefault: false },
];

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useQbitInstance(), { wrapper });
}

beforeEach(() => {
  mocks.params = new URLSearchParams();
  mocks.replace.mockClear();
  mocks.instances = INSTANCES;
  useUIStore.setState({ torrentsInstance: '' });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(mocks.instances)));
});

describe('useQbitInstance (QBT-29)', () => {
  it('is the default (no id sent) until one is chosen, and names it once the list is in', async () => {
    const { result } = render();
    expect(result.current.instanceId).toBeUndefined();
    await waitFor(() => expect(result.current.current?.id).toBe('q1'));
    expect(result.current.instanceId).toBeUndefined();
    expect(result.current.multiInstance).toBe(true);
    expect(result.current.subtitle).toBe('Main');
  });

  it('uses the last choice at once, before the list has loaded', () => {
    useUIStore.setState({ torrentsInstance: 'q2' });
    const { result } = render();
    expect(result.current.instanceId).toBe('q2');
  });

  it("takes a link's instance (a push about that qBittorrent) and keeps it as the choice", async () => {
    mocks.params = new URLSearchParams('instance=q2&name=Pack');
    const { result } = render();
    expect(result.current.instanceId).toBe('q2');
    await waitFor(() => expect(useUIStore.getState().torrentsInstance).toBe('q2'));
  });

  it('drops a choice that is no longer a qBittorrent, going back to the default', async () => {
    useUIStore.setState({ torrentsInstance: 'removed' });
    const { result } = render();
    await waitFor(() => expect(result.current.instanceId).toBeUndefined());
    await waitFor(() => expect(useUIStore.getState().torrentsInstance).toBe(''));
    expect(result.current.current?.id).toBe('q1');
  });

  it("never swaps a link's unknown instance for another qBittorrent", async () => {
    useUIStore.setState({ torrentsInstance: 'q2' });
    mocks.params = new URLSearchParams('instance=removed-qbit');
    const { result } = render();
    await waitFor(() => expect(result.current.instances).toHaveLength(2));
    // Still the named one, which the routes refuse; the page says it is gone.
    expect(result.current.instanceId).toBe('removed-qbit');
    expect(result.current.unknownLink).toBe(true);
    expect(result.current.current).toBeUndefined();
    expect(useUIStore.getState().torrentsInstance).toBe('q2');
  });

  it("takes a pick over the link's instance: the address then names the pick", async () => {
    mocks.params = new URLSearchParams('instance=q2&name=Pack');
    const { result, rerender } = render();
    await waitFor(() => expect(useUIStore.getState().torrentsInstance).toBe('q2'));
    act(() => result.current.select('q1'));
    expect(mocks.replace).toHaveBeenCalledWith(`${window.location.pathname}?instance=q1&name=Pack`);
    // Until the address changes the page stays on the link's instance, and the pick is not undone.
    rerender();
    expect(useUIStore.getState().torrentsInstance).toBe('q1');
    mocks.params = new URLSearchParams('instance=q1&name=Pack');
    rerender();
    expect(result.current.instanceId).toBe('q1');
    expect(useUIStore.getState().torrentsInstance).toBe('q1');
  });

  it('is not several with one qBittorrent', async () => {
    mocks.instances = [INSTANCES[0]];
    const { result } = render();
    await waitFor(() => expect(result.current.current?.id).toBe('q1'));
    expect(result.current.multiInstance).toBe(false);
    expect(result.current.subtitle).toBeUndefined();
  });
});
