// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));

import { ScheduledAlertDialog } from '../scheduled-alert-dialog';
import type { ScheduledAlertDraft } from '@/lib/scheduled-alerts/types';

let saves: Array<{ url: string; method: string; body: Record<string, unknown> }>;

beforeEach(() => {
  saves = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (url === '/api/scheduled-alerts/preview') {
      // The server finds album 8 already out and opens it on a custom date, from tomorrow.
      const released = body.draft?.albumId === 8;
      return Response.json({
        defaults: released
          ? { scheduleMode: 'absolute', scope: 'album', releaseTypes: ['album'], offsetMinutes: 60, absoluteNotifyAt: new Date(Date.now() + 86_400_000).toISOString() }
          : { scheduleMode: 'release_relative', scope: 'album', releaseTypes: ['album'], offsetMinutes: 60, absoluteNotifyAt: null },
        candidates: [],
        ...(released ? { released: 'album' } : {}),
      });
    }
    saves.push({ url, method: init?.method ?? 'GET', body });
    return Response.json({ alert: {} });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const albumDraft: ScheduledAlertDraft = {
  source: 'LIDARR', externalId: '7', mediaType: 'music', albumId: 7, title: 'Album 7', subtitle: 'Massive Attack', instanceId: 'lid-1',
};

function renderDialog(props: Partial<Parameters<typeof ScheduledAlertDialog>[0]> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ScheduledAlertDialog open onOpenChange={() => {}} draft={albumDraft} {...props} />
    </QueryClientProvider>,
  );
}

describe('the scheduled alert dialog for music', () => {
  it('offers album releases and saves an album alert', async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('button', { name: 'Album release' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Save alert' }));
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ url: '/api/scheduled-alerts', method: 'POST', body: { scope: 'album', draft: { source: 'LIDARR', externalId: '7' } } });
  });

  it('keeps a saved alert\'s scope when it is edited', async () => {
    // A draft rebuilt from a saved alert has no album id, so a guessed scope would be "artist".
    renderDialog({
      draft: { ...albumDraft, albumId: undefined },
      alertId: 'a1',
      initialScheduleMode: 'release_relative',
      initialReleaseTypes: ['album'],
      initialOffsetMinutes: 60,
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saves).toHaveLength(1);
    expect(saves[0].url).toBe('/api/scheduled-alerts/a1');
    expect(saves[0].body).not.toHaveProperty('scope');
    expect(saves[0].body).not.toHaveProperty('draft');
  });

  it('offers only a custom date for an album the server finds already out', async () => {
    // The draft's own date is not judged here: the server's verdict decides.
    renderDialog({ draft: { ...albumDraft, externalId: '8', albumId: 8, releaseDate: '2099-01-01T00:00:00Z' } });
    await screen.findByText('This album is already out, so only a custom date can remind you.');
    const release = screen.getByRole('button', { name: 'Release reminder' }) as HTMLButtonElement;
    expect(release.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Custom date' }).getAttribute('aria-pressed')).toBe('true');

    const user = userEvent.setup();
    await screen.findByDisplayValue(/T\d\d:\d\d$/);
    await user.click(screen.getByRole('button', { name: 'Save alert' }));
    expect(saves).toHaveLength(1);
    expect(saves[0].body).toMatchObject({ scheduleMode: 'absolute', scope: 'album' });
  });
});
