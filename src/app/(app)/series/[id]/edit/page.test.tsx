// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
  useSearchParams: () => new URLSearchParams('instance=son-2'),
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/components/media/tag-selector', () => ({ TagSelector: () => null }));
// Each Select as a native <select>, so a test can pick an option.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import SeriesEditPage from './page';

const SERIES = {
  id: 7, title: 'Show', qualityProfileId: 4, seriesType: 'standard', seasonFolder: true,
  monitored: true, monitorNewItems: 'none', tags: [], path: '/tv/Show', seasons: [],
};
let puts: { url: string; body: Record<string, unknown> }[];

beforeEach(() => {
  puts = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (init?.method === 'PUT') {
      puts.push({ url: `${url.pathname}${url.search}`, body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const body = url.pathname === '/api/sonarr/7' ? SERIES
      : url.pathname === '/api/sonarr/qualityprofiles' ? [{ id: 4, name: 'HD' }]
        : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SeriesEditPage /></QueryClientProvider>);
}

const monitorNewSeasonsSelect = () =>
  screen.getAllByRole('combobox').find((select) =>
    Array.from((select as HTMLSelectElement).options, (o) => o.value).join() === 'all,none') as HTMLSelectElement;

describe('edit series page', () => {
  it("shows the series' own Monitor New Seasons setting and saves the change on its instance", async () => {
    renderPage();
    await screen.findByText('Monitor New Seasons');
    await waitFor(() => expect(monitorNewSeasonsSelect().value).toBe('none'));

    fireEvent.change(monitorNewSeasonsSelect(), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toBe('/api/sonarr/7?instanceId=son-2');
    expect(puts[0].body).toEqual(expect.objectContaining({ id: 7, monitorNewItems: 'all', seriesType: 'standard' }));
  });

  it('keeps the setting unchanged when the user saves without touching it', async () => {
    renderPage();
    await screen.findByText('Monitor New Seasons');
    await waitFor(() => expect(monitorNewSeasonsSelect().value).toBe('none'));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual(expect.objectContaining({ monitorNewItems: 'none' }));
  });
});
