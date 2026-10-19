// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreflightResult } from '@/lib/manual-downloads/preflight';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  push: vi.fn(),
  preflight: [] as Array<() => Response>,
  send: [] as Array<() => Response | Promise<Response>>,
  bodies: [] as Array<{ url: string; request: Record<string, unknown>; torrent: unknown }>,
}));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: mocks.push, replace: mocks.push }) }));
vi.mock('@/components/media/tag-selector', () => ({ TagSelector: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { ManualDownloadForm, type LinkPrefill, type ReleaseInput } from '../manual-download-form';

const MAGNET = 'magnet:?xt=urn:btih:382CC016FF22946008ECDDCB0DDA820F42B0CD5A&dn=Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function plan(overrides: Partial<PreflightResult> = {}): PreflightResult {
  return {
    ok: true, errors: [], warnings: [],
    plan: {
      service: 'RADARR', instance: { id: 'r1', label: 'radarr-4k' },
      target: { externalId: 10331, title: 'Night of the Living Dead', year: 1968, existingId: null },
      release: { title: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP', name: 'x', infoHash: 'H', source: 'MAGNET' },
      parsed: { quality: 'Bluray-1080p', year: 1968 }, episodes: [], downloadClient: { id: 1, name: 'qBittorrent' }, downloadClientChoices: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.caps = new Set(['movies.add', 'series.add', 'movies.editMonitoring', 'series.editMonitoring']);
  mocks.push.mockReset();
  mocks.preflight = [];
  mocks.send = [];
  mocks.bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (init?.body instanceof FormData) {
      mocks.bodies.push({ url, request: JSON.parse(String(init.body.get('request'))), torrent: init.body.get('torrent') });
      return (url.endsWith('/preflight') ? mocks.preflight.shift()! : mocks.send.shift()!)();
    }
    if (url.startsWith('/api/instances')) return json([{ id: 'r1', type: 'RADARR', label: 'radarr-4k', isDefault: true }, { id: 's1', type: 'SONARR', label: 'sonarr', isDefault: true }]);
    if (url.startsWith('/api/radarr/qualityprofiles')) return json([{ id: 4, name: 'HD-1080p' }]);
    if (url.startsWith('/api/radarr/rootfolders')) return json([{ path: '/data/Movies' }]);
    if (url.startsWith('/api/radarr/lookup')) return json([{ title: 'Night of the Living Dead', year: 1968, tmdbId: 10331, library: { exists: false } }]);
    throw new Error(`unexpected ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderForm(release: ReleaseInput = { kind: 'magnet', magnet: MAGNET }, prefill: LinkPrefill | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (next: ReleaseInput) => (
    <QueryClientProvider client={client}>
      <ManualDownloadForm release={next} suggestedName="Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP" prefill={prefill} />
    </QueryClientProvider>
  );
  const result = render(view(release));
  return { ...result, changeRelease: (next: ReleaseInput) => result.rerender(view(next)) };
}

async function chooseFilm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Movie'), 'night of the living dead');
  await user.click(screen.getByRole('button', { name: 'Search Radarr' }));
  await user.click(await screen.findByRole('button', { name: /Night of the Living Dead \(1968\)/ }));
  // The instance's first profile and folder are chosen once they load.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check' }).hasAttribute('disabled')).toBe(false));
  return user;
}

describe('sending a release to Sonarr/Radarr', () => {
  it('checks first, then sends exactly what was checked and opens the linked download', async () => {
    mocks.preflight.push(() => json(plan()));
    mocks.send.push(() => json({ download: { id: 'md1', status: 'QUEUED' } }, 201));
    renderForm();
    const user = await chooseFilm();

    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Ready: Radarr will take it')).toBeTruthy();
    expect(screen.getByText('Bluray-1080p · 1968')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Send to Radarr' }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/torrents/linked/md1'));
    const [checked, sent] = mocks.bodies;
    expect(checked.request).toEqual({
      service: 'RADARR', instanceId: 'r1', externalId: 10331, magnetUrl: MAGNET,
      releaseTitle: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP',
      add: { qualityProfileId: 4, rootFolderPath: '/data/Movies', tags: [], minimumAvailability: 'released' },
    });
    const { clientRequestId, ...rest } = sent.request;
    expect(rest).toEqual(checked.request);
    expect(clientRequestId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('offers to monitor an unmonitored title, and a changed choice must be checked again', async () => {
    mocks.preflight.push(() => json(plan({ ok: false, errors: [{ code: 'TARGET_UNMONITORED', message: 'Night of the Living Dead is not monitored.' }] })));
    renderForm();
    const user = await chooseFilm();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Night of the Living Dead is not monitored.')).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: /Monitor Night of the Living Dead/ }));
    // The result belonged to the old choices: it is gone, and sending is not offered.
    expect(screen.queryByText('Night of the Living Dead is not monitored.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send to Radarr' })).toBeNull();
    mocks.preflight.push(() => json(plan()));
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByText('Ready: Radarr will take it');
    expect(mocks.bodies[1].request.monitorTarget).toBe(true);
  });

  it('shows a refusal from the send itself, and a retry of the same submission keeps its id', async () => {
    mocks.preflight.push(() => json(plan()));
    mocks.send.push(() => { throw new TypeError('Failed to fetch'); });
    mocks.send.push(() => json({ error: 'This release is already being sent.', ...plan({ ok: false, errors: [{ code: 'ALREADY_ACTIVE', message: 'This release is already being sent to radarr-4k.' }] }) }, 409));
    renderForm();
    const user = await chooseFilm();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await user.click(await screen.findByRole('button', { name: 'Send to Radarr' }));
    await user.click(await screen.findByRole('button', { name: 'Send to Radarr' }));

    expect(await screen.findByText('This release is already being sent to radarr-4k.')).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.bodies[1].request.clientRequestId).toBe(mocks.bodies[2].request.clientRequestId);
  });

  it('sends a .torrent file with the request, leaving the name to the torrent', async () => {
    mocks.preflight.push(() => json(plan()));
    const file = new File([new Uint8Array([100, 101])], 'release.torrent');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ManualDownloadForm release={{ kind: 'file', file }} suggestedName="" prefill={null} />
      </QueryClientProvider>,
    );
    const user = await chooseFilm();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Ready: Radarr will take it');
    expect(mocks.bodies[0].torrent).toBeInstanceOf(File);
    expect(mocks.bodies[0].request).not.toHaveProperty('magnetUrl');
    expect(mocks.bodies[0].request).not.toHaveProperty('releaseTitle');
  });

  it('keeps a late answer with the release it checked, not the one on screen when it arrives', async () => {
    let answer!: (response: Response) => void;
    mocks.preflight.push(() => new Promise<Response>((resolve) => { answer = resolve; }) as unknown as Response);
    const { changeRelease } = renderForm();
    const user = await chooseFilm();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(mocks.bodies).toHaveLength(1));

    // The release changes (on the add page, outside this form) while the check runs.
    changeRelease({ kind: 'magnet', magnet: MAGNET.replace('382CC016', '482CC016') });
    answer(json(plan({ ok: false, errors: [{ code: 'TARGET_UNMONITORED', message: 'Night of the Living Dead is not monitored.' }] })));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' }).hasAttribute('disabled')).toBe(false));
    expect(screen.queryByText('Night of the Living Dead is not monitored.')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Monitor/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send to Radarr' })).toBeNull();
  });

  it('treats a different .torrent file as a new release even with the same name, size and date', async () => {
    mocks.preflight.push(() => json(plan()));
    const picked = (bytes: number[]) => new File([new Uint8Array(bytes)], 'release.torrent', { lastModified: 1_700_000_000_000 });
    const { changeRelease } = renderForm({ kind: 'file', file: picked([1, 2]) });
    const user = await chooseFilm();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Ready: Radarr will take it');

    changeRelease({ kind: 'file', file: picked([3, 4]) });
    expect(screen.queryByText('Ready: Radarr will take it')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send to Radarr' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('does not offer to monitor the title to someone who may not change monitoring', async () => {
    mocks.caps.delete('movies.editMonitoring');
    mocks.preflight.push(() => json(plan({ ok: false, errors: [{ code: 'TARGET_UNMONITORED', message: 'Night of the Living Dead is not monitored.' }] })));
    renderForm();
    const user = await chooseFilm();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Night of the Living Dead is not monitored.')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /Monitor/ })).toBeNull();
    expect(screen.getByText(/this account may not change monitoring/)).toBeTruthy();
  });

  it('starts fresh when "Send again" names a library this user may not add to', async () => {
    mocks.caps = new Set(['movies.add']);
    renderForm({ kind: 'magnet', magnet: MAGNET }, { service: 'SONARR', instanceId: 's1', externalId: 81189, title: 'Breaking Bad', release: 'Breaking.Bad.S01.1080p' });
    expect(await screen.findByLabelText('Movie')).toBeTruthy();
    expect(screen.queryByLabelText('Series')).toBeNull();
    expect((screen.getByLabelText('Release name') as HTMLInputElement).value).not.toBe('Breaking.Bad.S01.1080p');
  });

  it('asks for the release before anything can be checked', async () => {
    renderForm({ kind: 'magnet', magnet: '' });
    expect(await screen.findByText('Paste a magnet link first.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check' }).hasAttribute('disabled')).toBe(true);
  });

  it('offers choosing files first, handing over the title and add options instead of checking a release', async () => {
    const onChooseFiles = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ManualDownloadForm release={{ kind: 'magnet', magnet: MAGNET }} suggestedName="x" prefill={null} onChooseFiles={onChooseFiles} />
      </QueryClientProvider>,
    );
    const user = await chooseFilm();
    await user.click(screen.getByRole('checkbox', { name: /Choose files before download/ }));
    expect(screen.queryByLabelText('Release name')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next: choose files' }));
    expect(onChooseFiles).toHaveBeenCalledWith({
      service: 'RADARR', instanceId: 'r1', externalId: 10331, title: 'Night of the Living Dead',
      add: { qualityProfileId: 4, rootFolderPath: '/data/Movies', tags: [], minimumAvailability: 'released' },
    });
    expect(mocks.bodies).toEqual([]);
  });
});
