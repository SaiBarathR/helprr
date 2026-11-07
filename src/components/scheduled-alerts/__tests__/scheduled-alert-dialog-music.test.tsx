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
      return Response.json({ defaults: { scheduleMode: 'release_relative', scope: 'album', releaseTypes: ['album'], offsetMinutes: 60, absoluteNotifyAt: null }, candidates: [] });
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
});
