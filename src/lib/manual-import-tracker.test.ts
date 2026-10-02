// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pollCommand: vi.fn(),
  invalidateActivity: vi.fn(),
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/arr-command', () => ({ pollCommand: mocks.pollCommand }));
vi.mock('@/lib/query-invalidation', () => ({ invalidateActivity: mocks.invalidateActivity }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import { QueryClient } from '@tanstack/react-query';
import {
  applyPendingImports,
  pendingImportKey,
  resetPendingImportsForTests,
  trackManualImport,
  usePendingImports,
  type PendingImports,
} from './manual-import-tracker';

const record = (downloadId: string, instanceId = 'son-1') => ({
  source: 'sonarr',
  instanceId,
  downloadId,
  trackedDownloadState: 'importPending',
  trackedDownloadStatus: 'warning',
});

// Read the tracker's store the way the Activity tabs do.
const seen: { latest: PendingImports } = { latest: new Map() };
function Probe({ report }: { report: (value: PendingImports) => void }) {
  report(usePendingImports());
  return null;
}
const isImporting = (downloadId: string) => seen.latest.has(pendingImportKey(record(downloadId)));

let root: Root;
let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

const track = (downloadId: string, commandId: number, title = 'Show S01E01') => trackManualImport(queryClient, {
  service: 'sonarr', instanceId: 'son-1', downloadId, commandId, title,
});

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.useFakeTimers();
  resetPendingImportsForTests();
  queryClient = new QueryClient();
  fetchMock = vi.fn(async () => Response.json({ id: 99 }));
  vi.stubGlobal('fetch', fetchMock);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(createElement(Probe, { report: (value) => { seen.latest = value; } })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('applyPendingImports', () => {
  it('shows downloads being imported as importing', () => {
    const records = [record('a'), record('b')];
    const out = applyPendingImports(records, new Map([[pendingImportKey(records[0]), 1]]));
    expect(out[0]).toMatchObject({ downloadId: 'a', trackedDownloadState: 'importing', trackedDownloadStatus: 'ok' });
    expect(out[1]).toBe(records[1]);
  });

  it('scopes a download to its app and instance', () => {
    const records = [record('a'), record('a', 'son-2')];
    const out = applyPendingImports(records, new Map([[pendingImportKey(records[0]), 1]]));
    expect(out[0].trackedDownloadState).toBe('importing');
    expect(out[1]).toBe(records[1]);
  });
});

describe('trackManualImport', () => {
  it('stays importing until the queue is read after the *arr refresh, then reports the import', async () => {
    let finishImport: (status: string) => void = () => {};
    mocks.pollCommand
      .mockImplementationOnce(() => new Promise((done) => { finishImport = done; }))
      .mockResolvedValueOnce('completed');

    let tracking!: Promise<void>;
    await act(async () => { tracking = track('a', 7); });
    expect(isImporting('a')).toBe(true);

    await act(async () => { finishImport('completed'); });
    expect(fetchMock).toHaveBeenCalledWith('/api/sonarr/command?instanceId=son-1', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'RefreshMonitoredDownloads' }),
    }));
    expect(mocks.pollCommand).toHaveBeenNthCalledWith(1, 'sonarr', 7, 'son-1');
    expect(mocks.pollCommand).toHaveBeenNthCalledWith(2, 'sonarr', 99, 'son-1');
    // The server's queue copy can still predate the refresh.
    expect(isImporting('a')).toBe(true);
    expect(mocks.invalidateActivity).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
      await tracking;
    });
    expect(mocks.invalidateActivity).toHaveBeenCalledWith(queryClient);
    expect(isImporting('a')).toBe(false);
    expect(mocks.toast.success).toHaveBeenCalledWith('Import finished for Show S01E01', expect.anything());
  });

  it('reports a failed import and stops treating it as in progress', async () => {
    mocks.pollCommand.mockResolvedValue('failed');
    await act(async () => { await track('a', 8, 'Movie'); });

    expect(isImporting('a')).toBe(false);
    expect(mocks.toast.error).toHaveBeenCalledWith('Import failed for Movie', expect.anything());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.invalidateActivity).toHaveBeenCalled();
  });

  it("keeps a later import of the same download marked when an earlier one fails", async () => {
    let failFirst: (status: string) => void = () => {};
    mocks.pollCommand
      .mockImplementationOnce(() => new Promise((done) => { failFirst = done; }))
      .mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => {
      void track('a', 7);
      void track('a', 8);
    });
    await act(async () => { failFirst('failed'); });
    expect(isImporting('a')).toBe(true);
  });
});
