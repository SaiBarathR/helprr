// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
  useSearchParams: () => new URLSearchParams('instance=inst-2'),
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

import ArtistEditPage from './page';

const ITEM = { id: 7, artistName: 'Band', qualityProfileId: 4, metadataProfileId: 1, monitorNewItems: 'all', monitored: false, tags: [], path: '/music/Band' };
const FOLDERS = ['/music', '/music2'];
let puts: { url: string; body: Record<string, unknown> }[];

beforeEach(() => {
  puts = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (init?.method === 'PUT') {
      puts.push({ url: `${url.pathname}${url.search}`, body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const body = url.pathname === '/api/lidarr/7' ? ITEM
      : url.pathname === '/api/lidarr/rootfolders' ? FOLDERS.map((path, i) => ({ id: i + 1, path }))
        : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ArtistEditPage /></QueryClientProvider>);
}

const rootFolderSelect = () =>
  screen.getAllByRole('combobox').find((select) =>
    Array.from((select as HTMLSelectElement).options, (o) => o.value).join() === FOLDERS.join()) as HTMLSelectElement;

describe('edit page root folder', () => {
  it('moves the files to a new root folder only after a confirmation', async () => {
    renderPage();
    await waitFor(() => expect(rootFolderSelect().value).toBe(FOLDERS[0]));
    expect(screen.queryByLabelText('Move Files')).toBeNull();

    fireEvent.change(rootFolderSelect(), { target: { value: FOLDERS[1] } });
    expect(screen.getByLabelText('Move Files').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Move files for Band?' });
    expect(confirm.textContent).toContain('into /music2/Band');
    expect(puts).toHaveLength(0);

    fireEvent.click(within(confirm).getByRole('button', { name: 'Move files' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toBe('/api/lidarr/7?moveFiles=true&instanceId=inst-2');
    expect(puts[0].body).toEqual(expect.objectContaining({ path: '/music2/Band' }));
  });

  it('changes only the saved path, without asking, when Move Files is off', async () => {
    renderPage();
    await waitFor(() => expect(rootFolderSelect().value).toBe(FOLDERS[0]));
    fireEvent.change(rootFolderSelect(), { target: { value: FOLDERS[1] } });
    fireEvent.click(screen.getByLabelText('Move Files'));
    expect(screen.getByText(/Only the saved path changes/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(puts[0].url).toBe('/api/lidarr/7?instanceId=inst-2');
    expect(puts[0].body).toEqual(expect.objectContaining({ path: '/music2/Band' }));
  });

  it('sends no move when the root folder is left alone', async () => {
    renderPage();
    await waitFor(() => expect(rootFolderSelect().value).toBe(FOLDERS[0]));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toBe('/api/lidarr/7?instanceId=inst-2');
    expect(puts[0].body).toEqual(expect.objectContaining({ path: ITEM.path }));
  });
});
