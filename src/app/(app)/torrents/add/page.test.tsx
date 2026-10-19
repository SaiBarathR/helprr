// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ caps: new Set<string>(), params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/components/torrents/manual-download-form', async () => {
  const { useState } = await import('react');
  return {
    ManualDownloadForm: function Form({ prefill }: { prefill: { title: string } | null }) {
      const [title, setTitle] = useState('');
      return (
        <div>
          Arr form{prefill ? ` for ${prefill.title}` : ''}
          <input aria-label="Arr title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
      );
    },
  };
});

import AddTorrentPage from './page';

const LINKER = ['torrents.add', 'activity.manage', 'movies.add'];

beforeEach(() => {
  mocks.params = new URLSearchParams();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AddTorrentPage /></QueryClientProvider>);
}

describe('Add Torrent: where it goes', () => {
  it('recommends Sonarr/Radarr to a user who may send there, and keeps qBittorrent one tap away', async () => {
    mocks.caps = new Set(LINKER);
    renderPage();
    expect((await screen.findByRole('radio', { name: /Send to Sonarr or Radarr/ })).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Arr form')).toBeTruthy();
    expect(screen.queryByLabelText('Save at')).toBeNull();

    await userEvent.type(screen.getByLabelText('Arr title'), 'Night');
    await userEvent.click(screen.getByRole('radio', { name: /Add to qBittorrent only/ }));
    expect(screen.getByLabelText('Save at')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Arr title' })).toBeNull();

    // A look at the other option loses nothing already chosen for Sonarr/Radarr.
    await userEvent.click(screen.getByRole('radio', { name: /Send to Sonarr or Radarr/ }));
    expect((screen.getByRole('textbox', { name: 'Arr title' }) as HTMLInputElement).value).toBe('Night');
    expect(screen.queryByLabelText('Save at')).toBeNull();
  });

  it('is the plain qBittorrent add for a user who may not send to Sonarr/Radarr', async () => {
    mocks.caps = new Set(['torrents.add', 'movies.add']);
    renderPage();
    expect(await screen.findByLabelText('Save at')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('prefills "Send again" from the link, asking for the magnet or file again', async () => {
    mocks.caps = new Set(LINKER);
    mocks.params = new URLSearchParams({ linkService: 'RADARR', linkInstance: 'r1', linkExternalId: '10331', linkTitle: 'Night of the Living Dead', linkRelease: 'R' });
    renderPage();
    expect(await screen.findByText('Arr form for Night of the Living Dead')).toBeTruthy();
    expect(screen.getByText(/paste the magnet link or choose the .torrent file again/)).toBeTruthy();
  });
});
