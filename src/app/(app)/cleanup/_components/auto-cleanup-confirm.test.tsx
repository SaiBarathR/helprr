// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoCleanupConfirmDialog, startsAutomaticDeletion } from './auto-cleanup-confirm';

describe('startsAutomaticDeletion', () => {
  const off = { enabled: true, autoRunMode: 'disabled' as const };
  const dryRun = { enabled: true, autoRunMode: 'dryRun' as const };
  const on = { enabled: true, autoRunMode: 'enabled' as const };
  const onButSwitchedOff = { enabled: false, autoRunMode: 'enabled' as const };

  it('asks when auto-run changes to enabled', () => {
    expect(startsAutomaticDeletion(off, on)).toBe(true);
    expect(startsAutomaticDeletion(dryRun, on)).toBe(true);
  });

  it('asks when the master switch turns on a cleaner already set to enabled', () => {
    expect(startsAutomaticDeletion(onButSwitchedOff, on)).toBe(true);
  });

  it('asks when nothing has been saved yet', () => {
    expect(startsAutomaticDeletion(null, on)).toBe(true);
  });

  it('does not ask when deletion was already on, or does not start', () => {
    expect(startsAutomaticDeletion(on, on)).toBe(false);
    expect(startsAutomaticDeletion(off, dryRun)).toBe(false);
    expect(startsAutomaticDeletion(off, onButSwitchedOff)).toBe(false);
    expect(startsAutomaticDeletion(on, off)).toBe(false);
  });
});

describe('AutoCleanupConfirmDialog', () => {
  let root: Root;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function open(total: number, onConfirm = vi.fn(), cleaner: 'queue' | 'download' = 'download', intervalMinutes = 60) {
    fetchMock = vi.fn(async () => Response.json({ page: 1, pageSize: 1, total, records: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AutoCleanupConfirmDialog open onOpenChange={() => {}} cleaner={cleaner} intervalMinutes={intervalMinutes} busy={false} onConfirm={onConfirm} />
        </QueryClientProvider>,
      );
    });
    await act(async () => { await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled()); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    return onConfirm;
  }

  it('says what turning it on does and recommends a dry run when none is on record', async () => {
    await open(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/cleanup/history?cleaner=download&action=dryRunPreview&pageSize=1', expect.anything());
    const text = document.body.textContent ?? '';
    expect(text).toContain('Turn on automatic deletion for the Download Cleaner?');
    expect(text).toContain('every hour without asking');
    expect(text).toContain('No dry-run results are on record for this cleaner');
  });

  it('says that a seeding rule decides whether the Download Cleaner deletes files', async () => {
    await open(0);
    expect(document.body.textContent).toContain('where a rule says so, deletes their files from disk');
  });

  it('says that the Queue Cleaner takes the downloaded data with it', async () => {
    await open(0, vi.fn(), 'queue', 10);
    expect(fetchMock).toHaveBeenCalledWith('/api/cleanup/history?cleaner=queue&action=dryRunPreview&pageSize=1', expect.anything());
    const text = document.body.textContent ?? '';
    expect(text).toContain('Turn on automatic deletion for the Queue Cleaner?');
    expect(text).toContain('every 10 minutes without asking: it removes them along with what they had downloaded.');
    expect(text).not.toContain('where a rule says so');
  });

  it('leaves the recommendation out when dry-run results exist', async () => {
    await open(4);
    expect(document.body.textContent).not.toContain('No dry-run results are on record');
  });

  it('saves only from its confirm button', async () => {
    const onConfirm = await open(4);
    expect(onConfirm).not.toHaveBeenCalled();
    const confirm = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('Turn on and save'));
    await act(async () => { confirm?.click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
