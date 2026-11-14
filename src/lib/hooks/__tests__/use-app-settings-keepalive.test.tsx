// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppSettings } from '../use-app-settings';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; body: unknown; keepalive: boolean; resolve: (body: Record<string, unknown>) => void };
let calls: Call[];
let server: Record<string, unknown>;

beforeEach(() => {
  calls = [];
  server = { logMaxFileMb: 50, logRetentionDays: 30 };
  vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') return Promise.resolve(new Response(JSON.stringify(server), { status: 200 }));
    // PUTs answer when the test says, to put them in flight together.
    return new Promise<Response>((resolve) => {
      calls.push({
        method,
        body: JSON.parse(String(init?.body)),
        keepalive: Boolean(init?.keepalive),
        resolve: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })),
      });
    });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useAppSettings(), { wrapper });
}
const gets = () => vi.mocked(fetch).mock.calls.filter(([, init]) => !init?.method || init.method === 'GET').length;

it('sends a keepalive save synchronously, outside the queue, and shows its answer', async () => {
  const { result } = setup();
  await waitFor(() => expect(result.current.settings?.logMaxFileMb).toBe(50));

  let saved: Promise<unknown>;
  act(() => { saved = result.current.update({ logMaxFileMb: 55 }, { keepalive: true }); });
  // Started in the same call: an unloading page gets no later tick.
  expect(calls).toEqual([expect.objectContaining({ method: 'PUT', body: { logMaxFileMb: 55 }, keepalive: true })]);
  await waitFor(() => expect(result.current.settings?.logMaxFileMb).toBe(55));

  await act(async () => { calls[0].resolve({ ...server, logMaxFileMb: 55 }); await saved; });
  expect(result.current.settings?.logMaxFileMb).toBe(55);
});

it('re-reads the settings once a queued save that was in flight has settled', async () => {
  const { result } = setup();
  await waitFor(() => expect(result.current.settings).not.toBeNull());
  const readsBefore = gets();

  // A blur save of 55 is in flight when the page hides with 56 typed.
  let queued: Promise<unknown>;
  act(() => { queued = result.current.update({ logMaxFileMb: 55 }); });
  await waitFor(() => expect(calls).toHaveLength(1));
  let hidden: Promise<unknown>;
  act(() => { hidden = result.current.update({ logMaxFileMb: 56 }, { keepalive: true }); });
  expect(calls[1]).toEqual(expect.objectContaining({ body: { logMaxFileMb: 56 }, keepalive: true }));

  // The server kept 56; the older save answers last.
  server = { ...server, logMaxFileMb: 56 };
  await act(async () => { calls[1].resolve(server); await hidden; });
  await act(async () => { calls[0].resolve({ ...server, logMaxFileMb: 55 }); await queued; });

  // Not whichever answer came back last: a fresh read of what was kept.
  await waitFor(() => expect(gets()).toBeGreaterThan(readsBefore));
  await waitFor(() => expect(result.current.settings?.logMaxFileMb).toBe(56));
});
