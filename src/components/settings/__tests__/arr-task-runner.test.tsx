// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/arr-command', () => ({ pollCommandAt: vi.fn(async () => 'completed') }));

import { useTaskRunner } from '../arr-system-panels';

afterEach(() => vi.unstubAllGlobals());

describe('useTaskRunner', () => {
  it('starts a task once for a double tap that lands before the button is disabled', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 7 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => {
      const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
      return useTaskRunner('son-1', { running, setRunning });
    }, { wrapper });

    await act(async () => {
      // Both taps in the same render: `running` still says nothing runs.
      await Promise.all([result.current.run('Backup', 'Back up'), result.current.run('Backup', 'Back up')]);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Once it ends, it can be run again.
    await act(async () => { await result.current.run('Backup', 'Back up'); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
