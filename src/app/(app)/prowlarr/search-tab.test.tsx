// @vitest-environment jsdom
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { SearchTab } from './search-tab';

// A test can seed the view state a returning user would have.
const seeded = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/hooks/use-route-view-state', () => ({
  useRouteViewState: <T,>(name: string, initial: T) => useState<T>((seeded.has(name) ? seeded.get(name) : initial) as T),
}));

const caps = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => caps.granted.has(cap) }));
// The form is covered on its own; here, what the sheet hands it.
const form = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock('@/components/torrents/manual-download-form', () => ({
  MANUAL_DOWNLOAD_MUTATION_KEY: ['manual-downloads', 'submit'],
  ManualDownloadForm: function Form(props: Record<string, unknown>) {
    form.props.push(props);
    // A check that never answers, under the form's own mutation key.
    const check = useMutation({ mutationKey: ['manual-downloads', 'submit'], mutationFn: () => new Promise(() => {}) });
    return <><p>manual download form</p><button type="button" onClick={() => check.mutate()}>Start check</button></>;
  },
}));

// jsdom lacks these; the options sheet (vaul) calls them.
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

const result = (id: string, title: string, publishDate: string | null) => ({
  id, title, size: 1024, seeders: 5, leechers: 1, publishDate, indexer: 'YTS', protocol: 'torrent',
});

const searches = () => vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).startsWith('/api/prowlarr/search?'));

function setup(client = new QueryClient()) {
  return render(<QueryClientProvider client={client}><SearchTab /></QueryClientProvider>);
}

const indexers = [
  { id: 1, name: 'YTS', enable: true, protocol: 'torrent', privacy: 'public' },
  { id: 2, name: 'Nyaa', enable: true, protocol: 'torrent', privacy: 'public' },
  { id: 3, name: 'Off', enable: false, protocol: 'torrent', privacy: 'private' },
];

function answer(body: unknown) {
  vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify(
    String(url).startsWith('/api/prowlarr/indexers') ? indexers : body,
  )));
}

beforeEach(() => {
  seeded.clear();
  caps.granted = new Set();
  form.props = [];
  vi.stubGlobal('fetch', vi.fn());
  answer({ results: [result('a', 'Big Buck Bunny', '2026-01-01')], total: 1 });
});

describe('SearchTab', () => {
  it('searches only from the button, sending the chosen categories then', async () => {
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Movies' }));
    expect(searches()).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Big Buck Bunny');
    expect(String(searches()[0][0])).toContain('q=bunny&categories=2000');

    await userEvent.click(screen.getByRole('button', { name: 'TV' }));
    expect(searches()).toHaveLength(1);
  });

  it('searches again for the same text, so a retry or expired result works', async () => {
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Big Buck Bunny');

    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(searches()).toHaveLength(2));
  });

  it('does not claim nothing exists when nothing came back', async () => {
    answer({ results: [], total: 0 });
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/an indexer may have failed/)).toBeTruthy();
  });

  it('sorts missing dates last under Newest', async () => {
    answer({ results: [result('a', 'Old', '2020-01-01'), result('b', 'Unknown', null), result('c', 'New', '2026-01-01')], total: 3 });
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Old');

    await userEvent.click(screen.getByRole('button', { name: 'Newest' }));

    const titles = screen.getAllByRole('button', { name: /^Grab / }).map((button) => button.getAttribute('aria-label'));
    expect(titles).toEqual(['Grab New', 'Grab Old', 'Grab Unknown']);
  });

  it('shows only the top 100 for the sort, and says how many were found', async () => {
    answer({
      results: Array.from({ length: 150 }, (_, i) => ({ ...result(`r${i}`, `Release ${i}`, null), size: i })),
      total: 900,
    });
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Top 100 of 900')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Size' }));
    expect(screen.getAllByRole('button', { name: /^Grab / })[0].getAttribute('aria-label')).toBe('Grab Release 149');
    expect(screen.getAllByRole('button', { name: /^Grab / })).toHaveLength(100);
  });

  it('sends the type, ids and picked indexers from the options sheet', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Search options' }));
    // The sheet's TV type, not the TV category chip behind it.
    const sheet = within(await screen.findByRole('dialog'));
    await userEvent.click(sheet.getByRole('button', { name: 'TV' }));
    await userEvent.type(screen.getByLabelText('TVDB ID'), '81189');
    await userEvent.type(screen.getByLabelText('Season'), '2');
    await userEvent.click(await sheet.findByRole('button', { name: /Nyaa/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    // An id alone is enough to search.
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Big Buck Bunny');

    const sent = new URL(String(searches()[0][0]), 'http://x').searchParams;
    expect(sent.get('type')).toBe('tvsearch');
    expect(sent.get('tvdbId')).toBe('81189');
    expect(sent.get('season')).toBe('2');
    expect(sent.get('indexerIds')).toBe('1');
    expect(sent.get('categories')).toBeNull();
  });

  it('shows why the server refused a search', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => (String(url).startsWith('/api/prowlarr/indexers')
      ? new Response(JSON.stringify(indexers))
      : new Response(JSON.stringify({ error: 'An indexer you picked is gone or disabled. Pick again.' }), { status: 400 })));
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/gone or disabled/)).toBeTruthy();
  });

  it('sends a remembered indexer pick as it is, so a gone one is refused rather than widened to all', async () => {
    // 3 is disabled now; dropping it would leave no pick, which means every indexer.
    seeded.set('searchIndexers', [3]);
    setup();
    await screen.findByRole('button', { name: 'Search options, 1 set' });
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(searches()).toHaveLength(1));
    expect(new URL(String(searches()[0][0]), 'http://x').searchParams.get('indexerIds')).toBe('3');
  });

  it('searches by a movie id alone, lower-casing a capitalised IMDb id', async () => {
    seeded.set('searchType', 'movie');
    seeded.set('searchIds', { imdbId: 'TT0111161' });
    setup();
    const button = screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await userEvent.click(button);

    await waitFor(() => expect(searches()).toHaveLength(1));
    const sent = new URL(String(searches()[0][0]), 'http://x').searchParams;
    expect(sent.get('type')).toBe('movie');
    expect(sent.get('imdbId')).toBe('tt0111161');
    expect(sent.get('q')).toBe('');
  });

  it('shows a typed id in the normal text colour and marks the placeholder as an example', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Search options' }));
    const sheet = within(await screen.findByRole('dialog'));
    await userEvent.click(sheet.getByRole('button', { name: 'TV' }));
    const tvdb = screen.getByLabelText('TVDB ID') as HTMLInputElement;

    // The label around it is muted; the field must not inherit that.
    expect(tvdb.className).toContain('text-foreground');
    expect(tvdb.placeholder).toBe('e.g. 81189');
    expect((screen.getByLabelText('Season') as HTMLInputElement).placeholder).toMatch(/^e\.g\. /);
  });

  it('keeps an empty indexer pick empty, so clearing the list never searches every indexer', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Search options' }));
    const sheet = within(await screen.findByRole('dialog'));
    await userEvent.click(await sheet.findByRole('button', { name: /YTS/ }));
    await userEvent.click(sheet.getByRole('button', { name: /Nyaa/ }));

    // Unticking the last one leaves none ticked, not every one.
    expect(sheet.getByRole('button', { name: /YTS/ }).getAttribute('aria-pressed')).toBe('false');
    expect(sheet.getByRole('button', { name: /Nyaa/ }).getAttribute('aria-pressed')).toBe('false');
    expect(sheet.getByText(/None ticked/)).toBeTruthy();
    await userEvent.click(sheet.getByRole('button', { name: 'Done' }));

    await userEvent.type(screen.getByRole('textbox'), 'bunny{Enter}');
    expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/No indexer is ticked/)).toBeTruthy();
    expect(searches()).toHaveLength(0);

    // Use all is the way back to every indexer.
    await userEvent.click(screen.getByRole('button', { name: /^Search options/ }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Use all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(searches()).toHaveLength(1));
    expect(new URL(String(searches()[0][0]), 'http://x').searchParams.get('indexerIds')).toBeNull();
  });

  it('does not run the last search again on a refresh once no indexer is ticked', async () => {
    const client = new QueryClient();
    setup(client);
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Big Buck Bunny');
    expect(searches()).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Search options' }));
    const sheet = within(await screen.findByRole('dialog'));
    await userEvent.click(await sheet.findByRole('button', { name: /YTS/ }));
    await userEvent.click(sheet.getByRole('button', { name: /Nyaa/ }));
    await userEvent.click(sheet.getByRole('button', { name: 'Done' }));

    // What pull-to-refresh and the freshness retry do.
    await client.invalidateQueries();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(searches()).toHaveLength(1);
  });

  describe('Send to Sonarr or Radarr', () => {
    const SEND_CAPS = ['torrents.add', 'activity.manage', 'movies.add'];
    async function searchFor(results: unknown[]) {
      answer({ results, total: results.length });
      const view = setup();
      await userEvent.type(screen.getByRole('textbox'), 'bunny');
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      return view;
    }

    it('is offered beside the grab for torrents, and opens the form with the release token', async () => {
      caps.granted = new Set(SEND_CAPS);
      await searchFor([result('tok-a', 'Big Buck Bunny', '2026-01-01'), { ...result('tok-b', 'Bunny NZB', '2026-01-01'), protocol: 'usenet' }]);
      await screen.findByText('Big Buck Bunny');

      expect(screen.getByRole('button', { name: 'Grab Big Buck Bunny' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Grab Bunny NZB' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Send to Sonarr or Radarr: Bunny NZB' })).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Send to Sonarr or Radarr: Big Buck Bunny' }));

      expect(await screen.findByText('manual download form')).toBeTruthy();
      expect(form.props.at(-1)).toEqual(expect.objectContaining({
        release: { kind: 'prowlarr', token: 'tok-a' }, suggestedName: 'Big Buck Bunny', prefill: null,
      }));
    });

    it('stays open while a check or send is on its way', async () => {
      caps.granted = new Set(SEND_CAPS);
      await searchFor([result('tok-a', 'Big Buck Bunny', '2026-01-01')]);
      await userEvent.click(await screen.findByRole('button', { name: 'Send to Sonarr or Radarr: Big Buck Bunny' }));
      await screen.findByText('manual download form');

      await userEvent.click(screen.getByRole('button', { name: 'Start check' }));
      await userEvent.keyboard('{Escape}');
      expect(screen.getByText('manual download form')).toBeTruthy();
    });

    it('closes on Escape when nothing is on its way', async () => {
      caps.granted = new Set(SEND_CAPS);
      await searchFor([result('tok-a', 'Big Buck Bunny', '2026-01-01')]);
      await userEvent.click(await screen.findByRole('button', { name: 'Send to Sonarr or Radarr: Big Buck Bunny' }));
      await screen.findByText('manual download form');

      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Send to Sonarr or Radarr' })).toBeNull());
    });

    it('is not offered without every capability a manual download needs', async () => {
      for (const missing of SEND_CAPS) {
        caps.granted = new Set(SEND_CAPS.filter((cap) => cap !== missing));
        const view = await searchFor([result('tok-a', 'Big Buck Bunny', '2026-01-01')]);
        await screen.findByText('Big Buck Bunny');
        expect(screen.queryByRole('button', { name: /^Send to Sonarr or Radarr/ }), missing).toBeNull();
        view.unmount();
      }
    });
  });
});
