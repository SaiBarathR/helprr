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

const NO_DATE = 'No Digital release date known for the next 90 days. The alert stays on and reminds you once there is one.';

beforeEach(() => {
  vi.clearAllMocks();
  // The server knows no digital date for this film yet.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/scheduled-alerts/preview') {
      return Response.json({
        defaults: { scheduleMode: 'release_relative', scope: 'movie', releaseTypes: ['digital'], offsetMinutes: 60, absoluteNotifyAt: null },
        candidates: [],
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
    expect(screen.queryByText(/date known for the next/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cinema release' }));
    expect(screen.getByText(/date known for the next/)).toBeTruthy();
  });

  it('gives no hint on an edit, which runs no preview', async () => {
    renderDialog({ alertId: 'a1', initialScheduleMode: 'release_relative', initialReleaseTypes: ['digital'], initialOffsetMinutes: 60 });
    expect(screen.queryByText(/date known for the next/)).toBeNull();
  });

  it('says "Alert updated" when an edit is saved and "Alert scheduled" for a new one', async () => {
    const user = userEvent.setup();
    const { unmount } = renderDialog({ alertId: 'a1', initialScheduleMode: 'release_relative', initialReleaseTypes: ['digital'], initialOffsetMinutes: 60 });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Alert updated'));
    unmount();

    renderDialog();
    await screen.findByText(/date known for the next/);
    await user.click(screen.getByRole('button', { name: 'Save alert' }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Alert scheduled'));
  });
});
