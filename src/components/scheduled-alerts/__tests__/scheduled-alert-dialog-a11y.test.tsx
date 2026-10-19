// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));

import { ScheduledAlertDialog } from '../scheduled-alert-dialog';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ count: 0, releases: [] }))));
});
afterEach(() => vi.unstubAllGlobals());

describe('the scheduled alert dialog', () => {
  it('tells assistive technology which alert type and release types are chosen', async () => {
    const draft = { source: 'tmdb', mediaType: 'movie', title: 'Night of the Living Dead', externalId: '10331' } as never;
    render(<QueryClientProvider client={new QueryClient()}><ScheduledAlertDialog open onOpenChange={() => {}} draft={draft} /></QueryClientProvider>);
    const user = userEvent.setup();

    const type = await screen.findByRole('group', { name: 'Alert type' });
    expect(within(type).getByRole('button', { name: 'Release reminder' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(type).getByRole('button', { name: 'Custom date' }).getAttribute('aria-pressed')).toBe('false');

    const more = screen.getByRole('button', { name: 'More options' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await user.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const kinds = within(screen.getByRole('group', { name: 'Release types' })).getAllByRole('button');
    expect(kinds.length).toBeGreaterThan(0);
    // Toggling a chip flips its pressed state.
    const chip = kinds[0];
    const before = chip.getAttribute('aria-pressed');
    expect(before === 'true' || before === 'false').toBe(true);
    await user.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe(before === 'true' ? 'false' : 'true');

    // Custom date: pressed, Release reminder not, and the release panel (gone) is not reported expanded.
    await user.click(within(type).getByRole('button', { name: 'Custom date' }));
    expect(within(type).getByRole('button', { name: 'Custom date' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(type).getByRole('button', { name: 'Release reminder' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Release types' })).toBeNull();
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });
});
