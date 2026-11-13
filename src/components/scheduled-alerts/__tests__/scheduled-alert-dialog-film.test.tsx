// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));

import { ScheduledAlertDialog } from '../scheduled-alert-dialog';
import type { ScheduledAlertDraft } from '@/lib/scheduled-alerts/types';

const NO_DATE = 'No Digital release date in the next 90 days yet. The alert stays on and reminds you when one comes up. Other releases are under More options.';
const preview = { tooSoon: false };

beforeEach(() => {
  vi.clearAllMocks();
  preview.tooSoon = false;
  // The server knows no digital date for this film yet.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/scheduled-alerts/preview') {
      return Response.json({
        defaults: { scheduleMode: 'release_relative', scope: 'movie', releaseTypes: ['digital'], offsetMinutes: 60, absoluteNotifyAt: null },
        candidates: [],
        ...(preview.tooSoon ? { tooSoon: true } : {}),
      });
    }
    return Response.json({ alert: {} });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const filmDraft: ScheduledAlertDraft = {
  source: 'TMDB', externalId: '1440769', mediaType: 'movie', title: 'Film', href: '/discover/movie/1440769',
};

function renderDialog(props: Partial<Parameters<typeof ScheduledAlertDialog>[0]> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ScheduledAlertDialog open onOpenChange={() => {}} draft={filmDraft} {...props} />
    </QueryClientProvider>,
  );
}

describe('the scheduled alert dialog for a film', () => {
  it('says when no date is known for the releases picked, until they change', async () => {
    renderDialog();
    const user = userEvent.setup();
    await screen.findByText(NO_DATE, { normalizer: (t) => t.replace(/\s+/g, ' ').trim() });

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('button', { name: 'Cinema release' }));
    expect(screen.queryByText(/date in the next/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cinema release' }));
    expect(screen.getByText(/date in the next/)).toBeTruthy();
  });

  it('gives no hint for an episode, whose date Sonarr\'s calendar may leave out', async () => {
    renderDialog({ draft: { ...filmDraft, source: 'SONARR', mediaType: 'series', externalId: '3', episodeId: 11, seasonNumber: 1 } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/date in the next/)).toBeNull();
  });

  it('gives no hint when the release is only due sooner than the notice', async () => {
    preview.tooSoon = true;
    renderDialog();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/date in the next/)).toBeNull();
  });

  it('gives no hint on an edit, which runs no preview', async () => {
    renderDialog({ alertId: 'a1', initialScheduleMode: 'release_relative', initialReleaseTypes: ['digital'], initialOffsetMinutes: 60 });
    expect(screen.queryByText(/date in the next/)).toBeNull();
  });

  it('says "Alert updated" when an edit is saved and "Alert scheduled" for a new one', async () => {
    const user = userEvent.setup();
    const { unmount } = renderDialog({ alertId: 'a1', initialScheduleMode: 'release_relative', initialReleaseTypes: ['digital'], initialOffsetMinutes: 60 });
    expect(screen.getByRole('heading', { name: 'Edit alert' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Alert updated'));
    unmount();

    renderDialog();
    await screen.findByText(/date in the next/);
    expect(screen.getByRole('heading', { name: 'Schedule alert' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save alert' }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Alert scheduled'));
  });

  it('leaves the title unfocused on a touch screen, so the keyboard does not cover the form', async () => {
    for (const coarse of [true, false]) {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} }));
      const { unmount } = renderDialog({ allowTitleEdit: true });
      const title = await screen.findByLabelText('Alert title');
      await vi.waitFor(() => expect(document.activeElement === title).toBe(!coarse));
      unmount();
    }
  });
});
