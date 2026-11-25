// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ caps: new Set<string>(), params: new URLSearchParams(), adds: [] as Array<() => Response>, replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), replace: mocks.replace }) }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/components/torrents/manual-download-form', async () => {
  const { useState } = await import('react');
  const { useMutation } = await import('@tanstack/react-query');
  const MANUAL_DOWNLOAD_MUTATION_KEY = ['manual-downloads', 'submit'];
  return {
    MANUAL_DOWNLOAD_MUTATION_KEY,
    ManualDownloadForm: function Form({ prefill, onChooseFiles, sourceHint }: { prefill: { title: string } | null; onChooseFiles?: (draft: unknown) => void; sourceHint?: string }) {
      const [title, setTitle] = useState('');
      // A send that has not answered yet.
      const send = useMutation({ mutationKey: MANUAL_DOWNLOAD_MUTATION_KEY, mutationFn: () => new Promise(() => {}) });
      return (
        <div>
          Arr form{prefill ? ` for ${prefill.title}` : ''}
          {sourceHint && <p>{sourceHint}</p>}
          <input aria-label="Arr title" value={title} onChange={(event) => setTitle(event.target.value)} />
          {onChooseFiles && (
            <button type="button" onClick={() => onChooseFiles({ service: 'RADARR', instanceId: 'r1', externalId: 10331, title: 'Night of the Living Dead' })}>Next: choose files</button>
          )}
          <button type="button" onClick={() => send.mutate()}>Arr send</button>
        </div>
      );
    },
  };
});

import AddTorrentPage from './page';

const LINKER = ['torrents.add', 'activity.manage', 'movies.add'];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  mocks.params = new URLSearchParams();
  mocks.adds = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/qbittorrent' && init?.method === 'POST') return mocks.adds.shift()!();
    if (url === '/api/qbittorrent/abc/files') return json({ files: [{ index: 0, name: 'Film/a.mkv', size: 10, priority: 1, progress: 0 }] });
    // The fallback's check: still running.
    if (url === '/api/manual-downloads/fallback/check') return new Promise<Response>(() => {});
    return json({});
  }));
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

  it('does not name a "Send again" title for a library this user may not add to', async () => {
    mocks.caps = new Set(['torrents.add', 'activity.manage', 'series.add']);
    mocks.params = new URLSearchParams({ linkService: 'RADARR', linkInstance: 'r1', linkExternalId: '10331', linkTitle: 'Night of the Living Dead', linkRelease: 'R' });
    renderPage();
    expect(await screen.findByText('Arr form')).toBeTruthy();
    expect(screen.queryByText(/Sending Night of the Living Dead again/)).toBeNull();
  });

  it('holds the choice of where it goes while a Sonarr/Radarr check or send is on its way', async () => {
    mocks.caps = new Set(LINKER);
    renderPage();
    const qbittorrent = await screen.findByRole('radio', { name: /Add to qBittorrent only/ });
    expect((qbittorrent as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Arr send' }));

    expect((qbittorrent as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: /Send to Sonarr or Radarr/ }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(qbittorrent);
    expect(screen.queryByLabelText('Save at')).toBeNull();
  });

  it('holds the choice of where it goes while a qBittorrent add is on its way', async () => {
    mocks.caps = new Set(LINKER);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (
      url === '/api/qbittorrent' && init?.method === 'POST' ? new Promise<Response>(() => {}) : new Response('{}')
    )));
    renderPage();
    await userEvent.click(await screen.findByRole('radio', { name: /Add to qBittorrent only/ }));
    // Pasted, as a user would: typing it renders the page once per character, too slow under load.
    await userEvent.click(screen.getByLabelText('Magnet or .torrent links'));
    await userEvent.paste('magnet:?xt=urn:btih:382CC016FF22946008ECDDCB0DDA820F42B0CD5A');
    await userEvent.click(screen.getByRole('button', { name: 'Add Torrent' }));

    expect((screen.getByRole('radio', { name: /Send to Sonarr or Radarr/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  describe('picking files for Sonarr/Radarr', () => {
    const REVIEWER = [...LINKER, 'torrents.manage', 'torrents.delete'];

    it('holds the file selection still while the fallback checks it', async () => {
      mocks.caps = new Set(REVIEWER);
      mocks.adds.push(() => json({ success: true, hash: 'abc' }));
      renderPage();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Next: choose files' }));
      const file = await screen.findByRole('checkbox', { name: 'Select a.mkv' });
      expect(file.matches(':disabled')).toBe(false);

      await user.click(screen.getByRole('button', { name: 'Check' }));
      await waitFor(() => expect(file.matches(':disabled')).toBe(true));
      expect(screen.getByRole('button', { name: 'Select None' }).matches(':disabled')).toBe(true);
    });

    it('forgets the Sonarr/Radarr choices of an add that failed, so "qBittorrent only" stays plain', async () => {
      mocks.caps = new Set(REVIEWER);
      mocks.adds.push(() => json({ error: 'qBittorrent did not answer' }, 502));
      mocks.adds.push(() => json({ success: true, hash: 'abc' }));
      renderPage();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Next: choose files' }));
      await waitFor(() => expect(mocks.adds).toHaveLength(1));

      await user.click(screen.getByRole('radio', { name: /Add to qBittorrent only/ }));
      await user.click(screen.getByLabelText('Magnet or .torrent links'));
      await user.paste('magnet:?xt=urn:btih:382CC016FF22946008ECDDCB0DDA820F42B0CD5A');
      await user.click(screen.getByRole('button', { name: 'Next: Choose Files' }));
      await screen.findByRole('checkbox', { name: 'Select a.mkv' });
      expect(screen.getByRole('button', { name: /Add (Stopped|& Start)/ })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Check' })).toBeNull();
    });
  });
});

describe('Add Torrent: options for qBittorrent', () => {
  const MAGNET = 'magnet:?xt=urn:btih:382CC016FF22946008ECDDCB0DDA820F42B0CD5A';
  let sent: RequestInit[];
  beforeEach(() => {
    sent = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/qbittorrent' && init?.method === 'POST') {
        sent.push(init);
        return json({ success: true, hash: 'abc' });
      }
      if (url === '/api/qbittorrent/options') return json({ tags: ['4k', 'movies'], queueingEnabled: true });
      return json({});
    }));
  });

  async function chooseOptions() {
    await userEvent.click(await screen.findByRole('button', { name: 'Add tag 4k' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New tag' }), 'mine{Enter}');
    await userEvent.click(screen.getByRole('checkbox', { name: /Download in order/ }));
  }

  it('sends tags, in-order download and the advanced options with a magnet', async () => {
    mocks.caps = new Set(['torrents.add', 'torrents.bandwidth']);
    renderPage();
    await userEvent.click(await screen.findByLabelText('Magnet or .torrent links'));
    await userEvent.paste(MAGNET);
    await chooseOptions();
    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    await userEvent.type(screen.getByLabelText('Name in qBittorrent'), 'My Film');
    await userEvent.type(screen.getByLabelText('Download limit'), '2');
    await userEvent.click(screen.getByRole('checkbox', { name: /Skip hash check/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Add to top of queue/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Torrent' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    const body = JSON.parse(sent[0].body as string);
    expect(body).toMatchObject({
      urls: MAGNET,
      tags: ['4k', 'mine'],
      sequentialDownload: true,
      firstLastPiecePrio: true,
      rename: 'My Film',
      dlLimit: 2 * 1024 * 1024,
      skipChecking: true,
      addToTopOfQueue: true,
    });
    // Left to qBittorrent: not sent at all.
    for (const key of ['upLimit', 'autoTMM', 'contentLayout']) expect(body).not.toHaveProperty(key);
  });

  it('sends the same options as form fields with a .torrent file', async () => {
    mocks.caps = new Set(['torrents.add']);
    const { container } = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Torrent File/ }));
    await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['d4:infodee'], 'a.torrent'));
    await chooseOptions();
    await userEvent.click(screen.getByRole('button', { name: 'Add Torrent' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    const form = sent[0].body as FormData;
    expect(form.getAll('tags')).toEqual(['4k', 'mine']);
    expect(form.get('sequentialDownload')).toBe('true');
    expect(form.get('firstLastPiecePrio')).toBe('true');
    expect(form.has('rename')).toBe(false);
  });

  it('keeps the advanced options folded away, counting the ones set', async () => {
    mocks.caps = new Set(['torrents.add', 'torrents.bandwidth']);
    renderPage();
    const advanced = await screen.findByRole('button', { name: 'Advanced' });
    expect(advanced.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Name in qBittorrent')).toBeNull();

    await userEvent.click(advanced);
    await userEvent.click(screen.getByRole('checkbox', { name: /Skip hash check/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByRole('button', { name: /^Advanced.*· 1 set$/ })).toBeTruthy();
  });

  it('sends the options with "Next: Choose Files", stopping the magnet once metadata arrives', async () => {
    mocks.caps = new Set(['torrents.add', 'torrents.manage', 'torrents.delete']);
    renderPage();
    await userEvent.click(await screen.findByLabelText('Magnet or .torrent links'));
    await userEvent.paste(MAGNET);
    await chooseOptions();
    await userEvent.click(screen.getByRole('button', { name: 'Next: Choose Files' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(JSON.parse(sent[0].body as string)).toMatchObject({
      paused: false,
      stopCondition: 'MetadataReceived',
      tags: ['4k', 'mine'],
      sequentialDownload: true,
      firstLastPiecePrio: true,
    });
  });

  it('sends none of them when the files are picked for Sonarr/Radarr', async () => {
    mocks.caps = new Set([...LINKER, 'torrents.manage', 'torrents.delete']);
    renderPage();
    await userEvent.click(await screen.findByLabelText('Magnet or .torrent links'));
    await userEvent.paste(MAGNET);
    await userEvent.click(screen.getByRole('radio', { name: /Add to qBittorrent only/ }));
    await chooseOptions();
    await userEvent.click(screen.getByRole('radio', { name: /Send to Sonarr or Radarr/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next: choose files' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    const body = JSON.parse(sent[0].body as string);
    for (const key of ['tags', 'sequentialDownload', 'firstLastPiecePrio']) expect(body).not.toHaveProperty(key);
  });

  it('offers speed limits only to a user who may change bandwidth', async () => {
    mocks.caps = new Set(['torrents.add']);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Advanced' }));
    expect(screen.getByLabelText('Name in qBittorrent')).toBeTruthy();
    expect(screen.queryByLabelText('Download limit')).toBeNull();
    expect(screen.queryByLabelText('Upload limit')).toBeNull();
  });
});

describe('Add Torrent: the empty Save at field names where the torrent goes', () => {
  // A qBittorrent with "Default Torrent Management Mode" and "Use Category paths
  // in Manual Mode" as given (checked against 5.1.4 in category-links.test.ts).
  function serve(autoTmmByDefault: boolean | null, categoryPathsInManualMode: boolean | null) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/qbittorrent/categories') return json({ tv: { name: 'tv', savePath: '/downloads/tv' } });
      if (url === '/api/qbittorrent/categories?details=1') {
        return json({
          categories: { tv: { name: 'tv', savePath: '/downloads/tv' } },
          defaultSavePath: '/downloads',
          subcategories: false,
          autoTmmByDefault,
          categoryPathsInManualMode,
          relocateOnCategoryPathChange: false,
        });
      }
      return json({});
    }));
  }

  beforeEach(() => {
    mocks.caps = new Set(['torrents.add']);
    // Radix Select in jsdom.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.scrollIntoView ??= () => {};
  });

  async function pick(label: string, option: RegExp) {
    await userEvent.click(screen.getByRole('combobox', { name: label }));
    await userEvent.click(await screen.findByRole('option', { name: option }));
  }
  const hint = () => (screen.getByLabelText('Save at') as HTMLInputElement).placeholder;

  const field = () => screen.getByLabelText('Save at') as HTMLInputElement;

  it("fills in the category's folder under manual management, as qBittorrent's own add dialog does", async () => {
    // Left empty, the torrent went to the default save path, not the category's folder.
    serve(false, false);
    renderPage();
    await waitFor(() => expect(hint()).toBe('/downloads'));
    await pick('Category', /^tv$/);
    expect(field().value).toBe('/downloads/tv');
    await pick('Category', /^None$/);
    expect(field().value).toBe('');

    await pick('Category', /^tv$/);
    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    await pick('Automatic management', /^Off$/);
    expect(field().value).toBe('/downloads/tv');
    await pick('Automatic management', /^On/);
    expect(field().value).toBe('');
    expect(hint()).toBe('/downloads/tv');
    expect(field().disabled).toBe(true);
  });

  it('stops following the category once the user edits the folder, and sends what is shown', async () => {
    serve(false, false);
    const sent: RequestInit[] = [];
    const served = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/qbittorrent' && init?.method === 'POST') {
        sent.push(init);
        return json({ success: true, hash: 'abc' });
      }
      return served(url, init);
    }));
    renderPage();
    await waitFor(() => expect(hint()).toBe('/downloads'));
    await userEvent.click(screen.getByLabelText('Magnet or .torrent links'));
    await userEvent.paste('magnet:?xt=urn:btih:382CC016FF22946008ECDDCB0DDA820F42B0CD5A');
    await pick('Category', /^tv$/);
    await userEvent.type(field(), '/new');
    expect(field().value).toBe('/downloads/tv/new');
    await pick('Category', /^None$/);
    expect(field().value).toBe('/downloads/tv/new');
    await pick('Category', /^tv$/);
    await userEvent.click(screen.getByRole('button', { name: 'Add Torrent' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(JSON.parse(sent[0].body as string)).toMatchObject({ category: 'tv', savepath: '/downloads/tv/new' });
  });

  it("is the category's folder when qBittorrent uses category paths in manual mode, or manages automatically by default", async () => {
    serve(false, true);
    const { unmount } = renderPage();
    await pick('Category', /^tv$/);
    expect(hint()).toBe('/downloads/tv');
    unmount();

    serve(true, false);
    renderPage();
    await pick('Category', /^tv$/);
    expect(hint()).toBe('/downloads/tv');
  });

  it('still lists the categories when the save-path settings fail to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/qbittorrent/categories') return json({ tv: { name: 'tv', savePath: '/downloads/tv' } });
      if (url === '/api/qbittorrent/categories?details=1') return json({ error: 'Failed' }, 502);
      return json({});
    }));
    renderPage();
    await pick('Category', /^tv$/);
    expect(hint()).toBe('qBittorrent default');
  });

  it("falls back to naming qBittorrent's default when qBittorrent doesn't say", async () => {
    serve(null, null);
    renderPage();
    await pick('Category', /^tv$/);
    expect(hint()).toBe('qBittorrent default');
  });
});

describe('Add Torrent: several at once, links, and shares', () => {
  const M1 = 'magnet:?xt=urn:btih:1111111111111111111111111111111111111111&dn=First';
  const M2 = 'magnet:?xt=urn:btih:2222222222222222222222222222222222222222&dn=Second';
  const LINK = 'https://example.org/files/Third.torrent?passkey=SECRET';
  let sent: RequestInit[];
  let answer: () => Response;
  beforeEach(() => {
    sent = [];
    answer = () => json({ success: true, hash: 'abc' });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/qbittorrent' && init?.method === 'POST') {
        sent.push(init);
        return answer();
      }
      if (url === '/api/share/torrents') return json({ files: [{ name: 'shared.torrent', data: btoa('d4:infodee') }] });
      return json({});
    }));
  });

  it('sends every line in one add and says how each went, leaving the one not added', async () => {
    mocks.caps = new Set(['torrents.add', 'torrents.manage', 'torrents.delete']);
    answer = () => json({
      results: [
        { index: 0, result: 'added', hash: '1'.repeat(40) },
        { index: 1, result: 'exists', hash: '2'.repeat(40) },
        { index: 2, result: 'failed', error: 'The link answered HTTP 404' },
      ],
    });
    renderPage();
    await userEvent.click(await screen.findByLabelText('Magnet or .torrent links'));
    await userEvent.paste(`${M1}\n\n${M2}\n${LINK}`);
    // Choose Files works on one torrent at a time.
    expect(screen.queryByRole('button', { name: 'Next: Choose Files' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add 3 Torrents' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(JSON.parse(sent[0].body as string).urls).toBe(`${M1}\n${M2}\n${LINK}`);
    expect(await screen.findByText('1 of 3 not added')).toBeTruthy();
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Added')).toBeTruthy();
    expect(screen.getByText('Already in qBittorrent')).toBeTruthy();
    expect(screen.getByText('The link answered HTTP 404')).toBeTruthy();
    // A link is named by its host and file, never its query.
    expect(screen.getByText('example.org · Third.torrent')).toBeTruthy();
    expect(screen.getByText('1 of 3 not added').closest('section')!.textContent).not.toContain('SECRET');
    expect((screen.getByLabelText('Magnet or .torrent links') as HTMLTextAreaElement).value).toBe(LINK);

    // The retry of what is left fails on its own: the earlier list goes, the error is a toast.
    answer = () => json({ error: 'The link answered HTTP 404' }, 502);
    await userEvent.click(screen.getByRole('button', { name: 'Add Torrent' }));
    await waitFor(() => expect(screen.queryByText('1 of 3 not added')).toBeNull());
  });

  it('sends several files in one add', async () => {
    mocks.caps = new Set(['torrents.add']);
    answer = () => json({ results: [{ index: 0, result: 'added', hash: 'a' }, { index: 1, result: 'added', hash: 'b' }] });
    const { container } = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Torrent Files/ }));
    await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, [
      new File(['d4:infodee'], 'a.torrent'),
      new File(['d4:infod1:xi1eee'], 'b.torrent'),
    ]);
    expect(screen.getByRole('button', { name: 'Remove a.torrent' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 Torrents' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0].body as FormData).getAll('file').map((file) => (file as File).name)).toEqual(['a.torrent', 'b.torrent']);
  });

  it('offers Choose Files for one .torrent link, and names the torrent from qBittorrent', async () => {
    mocks.caps = new Set(['torrents.add', 'torrents.manage', 'torrents.delete']);
    answer = () => json({ success: true, hash: 'abc', name: 'Night of the Living Dead' });
    renderPage();
    await userEvent.click(await screen.findByLabelText('Magnet or .torrent links'));
    await userEvent.paste(LINK);
    await userEvent.click(screen.getByRole('button', { name: 'Next: Choose Files' }));
    expect(await screen.findByText('Choose Files')).toBeTruthy();
  });

  it('tells Sonarr/Radarr senders that a link or several go to qBittorrent only', async () => {
    mocks.caps = new Set(LINKER);
    renderPage();
    await userEvent.click(await screen.findByLabelText('Magnet or .torrent links'));
    await userEvent.paste(M1);
    expect(screen.queryByText(/Sonarr and Radarr take one magnet link/)).toBeNull();
    await userEvent.paste(`\n${LINK}`);
    expect(screen.getByText(/Sonarr and Radarr take one magnet link/)).toBeTruthy();
  });

  it('opens with the links a share brought', async () => {
    mocks.caps = new Set(['torrents.add']);
    mocks.params = new URLSearchParams({ links: `${M1}\n${M2}` });
    renderPage();
    expect(((await screen.findByLabelText('Magnet or .torrent links')) as HTMLTextAreaElement).value).toBe(`${M1}\n${M2}`);
    expect(screen.getByRole('button', { name: 'Add 2 Torrents' })).toBeTruthy();
    // A link can carry a passkey: it leaves the address bar once it is in the form.
    expect(mocks.replace).toHaveBeenCalledWith('/torrents/add');
  });

  it('opens with the files a share brought', async () => {
    mocks.caps = new Set(['torrents.add']);
    mocks.params = new URLSearchParams({ shared: 'files' });
    renderPage();
    expect(await screen.findByText('shared.torrent')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add Torrent' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(((sent[0].body as FormData).get('file') as File).name).toBe('shared.torrent');
  });
});
