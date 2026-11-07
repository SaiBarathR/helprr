// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TonightTitle } from '@/types/tonight';
import { SWIPE_COMMIT_PX, TonightSwipeCard } from './tonight-swipe-card';

vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }));

const title: TonightTitle = {
  mediaType: 'movie', id: 7, instanceId: 'r1', title: 'Heat', year: 1995, overview: 'A heist.',
  posterUrl: null, backdropUrl: null, runtime: 170, genres: ['Crime'], href: '/movies/7?instance=r1',
  rating: 8.3, imdbId: 'tt0113277', tmdbId: 949, tvdbId: null,
};

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function drag(card: HTMLElement, dx: number, dy = 0) {
  fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 300, pointerType: 'touch' });
  fireEvent.pointerMove(card, { pointerId: 1, clientX: 200 + dx / 2, clientY: 300 + dy / 2, pointerType: 'touch' });
  fireEvent.pointerMove(card, { pointerId: 1, clientX: 200 + dx, clientY: 300 + dy, pointerType: 'touch' });
  fireEvent.pointerUp(card, { pointerId: 1, clientX: 200 + dx, clientY: 300 + dy, pointerType: 'touch' });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TonightSwipeCard', () => {
  it('shows the title and its details', () => {
    render(<TonightSwipeCard title={title} onVote={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Heat' })).toBeTruthy();
    expect(screen.getByText('170m')).toBeTruthy();
    expect(screen.getByText('A heist.')).toBeTruthy();
  });

  it('a swipe right past the threshold votes yes after the card flies out', () => {
    const onVote = vi.fn();
    render(<TonightSwipeCard title={title} onVote={onVote} />);
    const card = screen.getByTestId('tonight-card');
    drag(card, SWIPE_COMMIT_PX + 20);
    expect(card.style.transform).toContain('translateX');
    expect(onVote).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(onVote).toHaveBeenCalledWith(true);
  });

  it('a swipe left votes no', () => {
    const onVote = vi.fn();
    render(<TonightSwipeCard title={title} onVote={onVote} />);
    drag(screen.getByTestId('tonight-card'), -(SWIPE_COMMIT_PX + 20));
    vi.advanceTimersByTime(250);
    expect(onVote).toHaveBeenCalledWith(false);
  });

  it('a short drag snaps back without voting', () => {
    const onVote = vi.fn();
    render(<TonightSwipeCard title={title} onVote={onVote} />);
    const card = screen.getByTestId('tonight-card');
    drag(card, SWIPE_COMMIT_PX - 30);
    vi.advanceTimersByTime(250);
    expect(onVote).not.toHaveBeenCalled();
    expect(card.style.transform).toBe('');
  });

  it('a mostly vertical move is a scroll, not a vote', () => {
    const onVote = vi.fn();
    render(<TonightSwipeCard title={title} onVote={onVote} />);
    drag(screen.getByTestId('tonight-card'), SWIPE_COMMIT_PX + 20, 400);
    vi.advanceTimersByTime(250);
    expect(onVote).not.toHaveBeenCalled();
  });

  it('the buttons vote, once per card', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onVote = vi.fn();
    render(<TonightSwipeCard title={title} onVote={onVote} />);
    const yes = screen.getByRole('button', { name: 'Yes, watch Heat' });
    await user.click(yes);
    await user.click(yes);
    vi.advanceTimersByTime(250);
    expect(onVote).toHaveBeenCalledTimes(1);
    expect(onVote).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Not tonight: Heat' })).toHaveProperty('disabled', true);
  });

  it('with reduced motion the vote lands at once, with no tilt or fly-out', () => {
    setReducedMotion(true);
    const onVote = vi.fn();
    render(<TonightSwipeCard title={title} onVote={onVote} />);
    const card = screen.getByTestId('tonight-card');
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 300, pointerType: 'touch' });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 260, clientY: 300, pointerType: 'touch' });
    expect(card.style.transform).toBe('translateX(60px) rotate(0deg)');
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 200 + SWIPE_COMMIT_PX + 10, clientY: 300, pointerType: 'touch' });
    fireEvent.pointerUp(card, { pointerId: 1, pointerType: 'touch' });
    expect(onVote).toHaveBeenCalledWith(true);
  });

  it('does nothing while disabled', () => {
    const onVote = vi.fn();
    render(<TonightSwipeCard title={title} onVote={onVote} disabled />);
    drag(screen.getByTestId('tonight-card'), SWIPE_COMMIT_PX + 20);
    vi.advanceTimersByTime(250);
    expect(onVote).not.toHaveBeenCalled();
  });
});
