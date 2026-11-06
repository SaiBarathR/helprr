// @vitest-environment jsdom
// The movie page's Play button sits right above the searches and Files. While the
// Jellyfin lookup is pending it must hold its space, so it cannot pop in and push
// the buttons the user is about to tap (gap plan U8 follow-up).
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ canView: true }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => mocks.canView }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));

import { PlayInHelprrButton } from './play-in-helprr-button';

type Answer = { itemId?: string } | 'error' | 'offline';
let answers: Array<(value: Answer) => void>;
const answer = (value: Answer) => answers.at(-1)!(value);

beforeEach(() => {
  mocks.canView = true;
  answers = [];
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve, reject) => {
    answers.push((value) => {
      if (value === 'offline') reject(new TypeError('Failed to fetch'));
      else resolve(value === 'error' ? new Response(null, { status: 502 }) : Response.json(value));
    });
  })));
});
afterEach(() => vi.unstubAllGlobals());

const placeholder = (container: HTMLElement) => container.querySelector('[data-slot="skeleton"]');

describe('PlayInHelprrButton placeholder', () => {
  it('holds the button\'s size while the lookup is pending, then shows the real button', async () => {
    const { container } = render(<PlayInHelprrButton tmdbId={1} reserveSpace className="h-10 w-full rounded-full" />);
    const slot = placeholder(container);
    expect(slot).toBeTruthy();
    expect(slot!.getAttribute('aria-hidden')).toBe('true');
    expect(slot!.className.split(' ')).toEqual(expect.arrayContaining(['h-10', 'w-full', 'rounded-full']));
    expect(screen.queryByRole('link', { name: 'Play' })).toBeNull();

    answer({ itemId: 'jf-1' });
    const play = await screen.findByRole('link', { name: 'Play' });
    expect(play.getAttribute('href')).toBe('/jellyfin/library/item/jf-1?play=1');
    expect(play.className.split(' ')).toEqual(expect.arrayContaining(['h-10', 'w-full', 'rounded-full']));
    expect(placeholder(container)).toBeNull();
  });

  it('uses the button size\'s height when the caller gives none', () => {
    const { container } = render(<PlayInHelprrButton tmdbId={1} reserveSpace size="sm" />);
    expect(placeholder(container)!.className.split(' ')).toContain('h-8');
  });

  it.each<Answer>([{}, 'error', 'offline'])('collapses when the title is not in Jellyfin (%j)', async (value) => {
    const { container } = render(<PlayInHelprrButton tmdbId={1} reserveSpace className="h-10 w-full" />);
    expect(placeholder(container)).toBeTruthy();
    answer(value);
    await waitFor(() => expect(placeholder(container)).toBeNull());
    expect(container.innerHTML).toBe('');
  });

  it('goes back to pending for new ids and ignores the old lookup\'s late answer', async () => {
    const { container, rerender } = render(<PlayInHelprrButton tmdbId={1} reserveSpace />);
    rerender(<PlayInHelprrButton tmdbId={2} reserveSpace />);
    expect(answers).toHaveLength(2);
    await act(async () => {
      answers[0]({ itemId: 'jf-1' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(placeholder(container)).toBeTruthy();
    answers[1]({ itemId: 'jf-2' });
    expect((await screen.findByRole('link', { name: 'Play' })).getAttribute('href')).toBe('/jellyfin/library/item/jf-2?play=1');
  });

  it('reserves nothing unless asked, or when no lookup will run', () => {
    expect(render(<PlayInHelprrButton tmdbId={1} />).container.innerHTML).toBe('');
    expect(render(<PlayInHelprrButton reserveSpace />).container.innerHTML).toBe('');
    mocks.canView = false;
    expect(render(<PlayInHelprrButton tmdbId={1} reserveSpace />).container.innerHTML).toBe('');
  });
});
