// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('@/components/watchlist/watchlist-add-dialog', () => ({
  WatchlistAddDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Watchlist dialog" /> : null),
}));

import { PosterQuickActions } from './poster-quick-actions';
import { WatchlistButton } from '@/components/watchlist/watchlist-button';
import { ScheduledAlertButton } from '@/components/scheduled-alerts/scheduled-alert-dialog';

const draft = { source: 'tmdb', mediaType: 'movie', title: 'Heat', externalId: '949' } as never;
const LOOK = 'inline-flex h-5 w-5 items-center justify-center rounded-md';

function renderActions(watchlist: boolean, schedule: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PosterQuickActions
        watchlistDraft={draft}
        scheduleDraft={draft}
        watchlist={watchlist}
        schedule={schedule}
        buttonClassName={LOOK}
      />
    </QueryClientProvider>,
  );
}
const classesOf = (name: string) => screen.getByRole('button', { name }).className.split(/\s+/);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ count: 0, releases: [] }))));
});
afterEach(() => vi.unstubAllGlobals());

describe('PosterQuickActions', () => {
  it('turns the pair into one 44px menu button on touch screens and keeps both icons for a mouse', () => {
    renderActions(true, true);
    for (const name of ['Add to watchlist', 'Schedule alert']) {
      const classes = classesOf(name);
      expect(classes).toContain('pointer-coarse:hidden');
      // Side by side on a small poster, so only the height grows, as before.
      expect(classes).toContain('touch-target-y');
      expect(classes).not.toContain('touch-target');
    }
    const menu = classesOf('Watchlist or alert');
    expect(menu).toEqual(expect.arrayContaining(['hidden', 'pointer-coarse:inline-flex', 'touch-target', 'after:top-0']));
    expect(menu).not.toContain('inline-flex');
  });

  it('opens either dialog from the touch-screen menu', async () => {
    const user = userEvent.setup();
    renderActions(true, true);

    await user.click(screen.getByRole('button', { name: 'Watchlist or alert' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Add to watchlist…' }));
    expect(await screen.findByRole('dialog', { name: 'Watchlist dialog' })).toBeTruthy();
  });

  it('opens the alert dialog from the touch-screen menu', async () => {
    const user = userEvent.setup();
    renderActions(true, true);

    await user.click(screen.getByRole('button', { name: 'Watchlist or alert' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Schedule alert…' }));
    expect(await screen.findByRole('group', { name: 'Alert type' })).toBeTruthy();
  });

  it('does not open the menu when a finger lands on it, only on the tap', async () => {
    renderActions(true, true);
    const trigger = screen.getByRole('button', { name: 'Watchlist or alert' });

    // A swipe of the poster rail that starts here: touch down, no click.
    fireEvent.pointerDown(trigger, { pointerType: 'touch', button: 0, ctrlKey: false });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(await screen.findByRole('menuitem', { name: 'Schedule alert…' })).toBeTruthy();
  });

  it('gives a lone icon its full hit area and no menu', () => {
    renderActions(false, true);
    expect(screen.queryByRole('button', { name: 'Watchlist or alert' })).toBeNull();
    const classes = classesOf('Schedule alert');
    expect(classes).toEqual(expect.arrayContaining(['touch-target', 'after:top-0']));
    expect(classes).not.toContain('pointer-coarse:hidden');
  });
});

describe('icon buttons outside posters', () => {
  it('get a full 44px hit area, and the alert after the watchlist grows away from it', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <div>
          <WatchlistButton draft={draft} variant="icon" className="h-7 w-7" />
          <ScheduledAlertButton draft={draft} variant="icon" className="h-7 w-7" />
        </div>
      </QueryClientProvider>,
    );
    expect(classesOf('Add to watchlist')).toContain('touch-target');
    expect(classesOf('Schedule alert')).toContain('touch-target');
    // The closed watchlist dialog leaves nothing between them, so the
    // `.touch-target + .touch-target` rule in globals.css applies.
    expect(container.querySelector('.touch-target + .touch-target')?.getAttribute('aria-label')).toBe('Schedule alert');
  });
});
