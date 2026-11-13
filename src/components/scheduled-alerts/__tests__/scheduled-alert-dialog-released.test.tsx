// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));

import { ScheduledAlertDialog } from '../scheduled-alert-dialog';
import type { ReleasedKind, ScheduledAlertDraft } from '@/lib/scheduled-alerts/types';

afterEach(() => vi.unstubAllGlobals());

function renderWithVerdict(draft: ScheduledAlertDraft, released: ReleasedKind) {
  // The server finds it already out and opens it on a custom date, from tomorrow.
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    defaults: { scheduleMode: 'absolute', scope: draft.mediaType === 'movie' ? 'movie' : 'episode', releaseTypes: ['digital'], offsetMinutes: 60, absoluteNotifyAt: new Date(Date.now() + 86_400_000).toISOString() },
    candidates: [],
    released,
  })));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ScheduledAlertDialog open onOpenChange={() => {}} draft={draft} />
    </QueryClientProvider>,
  );
}

describe('the scheduled alert dialog for something already out', () => {
  it.each([
    ['movie', { source: 'RADARR', externalId: '5', mediaType: 'movie', title: 'Film' }, 'This movie is already out, so only a custom date can remind you.'],
    ['episode', { source: 'SONARR', externalId: '3', mediaType: 'series', title: 'Show', episodeId: 11, seasonNumber: 1 }, 'This episode has already aired, so only a custom date can remind you.'],
  ] as const)('offers only a custom date for a %s', async (released, draft, note) => {
    renderWithVerdict(draft as ScheduledAlertDraft, released);
    await screen.findByText(note);
    expect((screen.getByRole('button', { name: 'Release reminder' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Custom date' }).getAttribute('aria-pressed')).toBe('true');
  });
});
