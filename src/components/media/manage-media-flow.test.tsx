// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ back: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ back: mocks.back, push: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Drawer: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
    DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass, DrawerDescription: Pass,
  };
});

import { ManageMediaFlow } from './manage-media-flow';

const FILE = {
  path: '/movies/Alien (1979)/Alien.mkv', relativePath: 'Alien.mkv', name: 'Alien', size: 1024,
  movieFileId: 31, quality: { quality: { id: 7, name: 'Bluray-1080p' } }, languages: [], rejections: [],
};

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  void init;
  if (url.startsWith('/api/radarr/manualimport/scan') || url.startsWith('/api/sonarr/manualimport/scan')) {
    return Response.json([FILE]);
  }
  if (url.startsWith('/api/radarr/moviefile')) return Response.json({ success: true });
  return Response.json([]);
});

beforeEach(() => {
  fetchMock.mockClear();
  mocks.back.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

function renderFlow(service: 'radarr' | 'sonarr') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ManageMediaFlow service={service} mediaId={5} mediaTitle="Alien" instanceId="rad-1" />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('Manage files: edition', () => {
  it("sets a picked edition on a library file and sends only that change", async () => {
    const user = renderFlow('radarr');
    await user.click(await screen.findByTestId('manage-file-card'));
    await user.click(screen.getByRole('button', { name: /Select…/ }));
    await user.click(screen.getByRole('button', { name: 'Select Edition' }));
    await user.click(screen.getByRole('button', { name: "Director's Cut" }));
    expect((screen.getByLabelText('Edition') as HTMLInputElement).value).toBe("Director's Cut");
    await user.click(screen.getByRole('button', { name: 'Set Edition' }));
    expect(await screen.findByText("Director's Cut")).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(mocks.back).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(url).toBe('/api/radarr/moviefile?instanceId=rad-1');
    expect(JSON.parse(String(init?.body))).toEqual({ movieId: 5, mediaTitle: 'Alien', edits: [{ id: 31, edition: "Director's Cut" }] });
  });

  it('takes free text, trimmed, and can clear the edition', async () => {
    const user = renderFlow('radarr');
    await user.click(await screen.findByTestId('manage-file-card'));
    await user.click(screen.getByRole('button', { name: /Select…/ }));
    await user.click(screen.getByRole('button', { name: 'Select Edition' }));
    expect((screen.getByRole('button', { name: 'Set Edition' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Clear Edition' }));
    expect(await screen.findByText('No edition')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Select…/ }));
    await user.click(screen.getByRole('button', { name: 'Select Edition' }));
    await user.type(screen.getByLabelText('Edition'), '  Final Cut  ');
    await user.click(screen.getByRole('button', { name: 'Set Edition' }));
    expect(await screen.findByText('Final Cut')).toBeTruthy();
  });

  it('is not offered for Sonarr episode files', async () => {
    const user = renderFlow('sonarr');
    await user.click(await screen.findByTestId('manage-file-card'));
    await user.click(screen.getByRole('button', { name: /Select…/ }));
    expect(screen.getByRole('button', { name: 'Select Quality' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select Edition' })).toBeNull();
  });
});
