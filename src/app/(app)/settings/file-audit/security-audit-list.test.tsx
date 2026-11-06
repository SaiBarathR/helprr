// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecurityAuditList, type SecurityAuditRecord } from './security-audit-list';

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function row(id: string, action: SecurityAuditRecord['action'], extra: Partial<SecurityAuditRecord> = {}): SecurityAuditRecord {
  return {
    id,
    actorUsername: null,
    action,
    targetType: 'user',
    targetId: null,
    targetLabel: `label-${id}`,
    fields: null,
    count: 1,
    ip: null,
    userAgent: null,
    requestId: null,
    createdAt: '2026-11-06T12:00:00.000Z',
    ...extra,
  };
}

const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); });
const loadMore = () => [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Load more'));
const titles = () => [...container.querySelectorAll('p.font-medium')].map((p) => p.textContent);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi.fn(async (url: string) => {
    const params = new URL(url, 'http://localhost').searchParams;
    const page = Number(params.get('page'));
    if (params.get('hideFailedSignIns') === '1') {
      return new Response(JSON.stringify({ page, total: 1, records: [row('u1', 'USER_UPDATED', { fields: ['role'] })] }));
    }
    const records = page === 1
      ? [row('f1', 'LOGIN_FAILED', { fields: ['password'], count: 4, targetLabel: 'pa… (12 chars)' }), row('f2', 'LOGIN_FAILED', { fields: ['password'], targetId: 'user-1' })]
      // A new event shifted the offsets: f2 comes back on page 2.
      : [row('f2', 'LOGIN_FAILED', { fields: ['password'], targetId: 'user-1' }), row('u1', 'USER_UPDATED', { fields: ['password'], count: 3 })];
    return new Response(JSON.stringify({ page, total: 3, records }));
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => root.render(<QueryClientProvider client={client}><SecurityAuditList /></QueryClientProvider>));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('SecurityAuditList', () => {
  it('loads more pages, drops a repeated row, and stops at the total', async () => {
    await flush();
    expect(titles()).toEqual(['pa… (12 chars)', 'label-f2']);
    expect(container.textContent).toContain('with password · 4 attempts · unknown username');
    expect(loadMore()?.textContent).toBe('Load more (2 of 3)');

    await act(async () => loadMore()!.click());
    await flush();
    expect(String(fetchMock.mock.calls[1][0])).toContain('page=2');
    expect(titles()).toEqual(['pa… (12 chars)', 'label-f2', 'label-u1']);
    expect(container.textContent).toContain('password · 3 sessions signed out');
    expect(loadMore()).toBeUndefined();
  });

  it('keeps the loaded rows and offers a retry when a later page fails', async () => {
    await flush();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'down' }), { status: 500 }));
    await act(async () => loadMore()!.click());
    await flush();
    expect(titles()).toEqual(['pa… (12 chars)', 'label-f2']);
    expect(container.textContent).not.toContain('Failed to load the security log.');
    expect(loadMore()).toBeUndefined();
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry loading more');
    await act(async () => retry!.click());
    await flush();
    expect(titles()).toEqual(['pa… (12 chars)', 'label-f2', 'label-u1']);
  });

  it('hides failed sign-ins on the server when the switch is on', async () => {
    await flush();
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="switch"]')!.click());
    await flush();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('hideFailedSignIns=1');
    expect(titles()).toEqual(['label-u1']);
    expect(loadMore()).toBeUndefined();
  });
});
