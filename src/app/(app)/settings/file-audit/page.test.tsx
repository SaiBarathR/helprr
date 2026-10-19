// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/app-link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

import FileAuditPage from './page';

const record = (extra: Record<string, unknown>) => ({
  id: 'a1', username: 'admin', service: 'QBITTORRENT', instanceId: null, operation: 'DELETE_TORRENT', mediaType: 'torrent', mediaId: null,
  mediaTitle: 'Some.Release', fileCount: 1, filesDeleted: true, details: null, success: true, errorMessage: null, requestId: null,
  createdAt: new Date().toISOString(), ...extra,
});

let records: unknown[] = [];
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ records, total: records.length }))));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><FileAuditPage /></QueryClientProvider>);
}

describe('Operation audit', () => {
  it('says files were deleted only when the operation succeeded', async () => {
    records = [record({ id: 'ok' }), record({ id: 'failed', success: false, errorMessage: 'Request failed with status code 500' })];
    renderPage();
    expect(await screen.findByText(/files\/data deleted/)).toBeTruthy();
    expect(screen.getByText(/files\/data were to be deleted/)).toBeTruthy();
    expect(screen.getAllByText(/files\/data deleted/)).toHaveLength(1);
    expect(screen.getByText('Request failed with status code 500')).toBeTruthy();
  });
});
