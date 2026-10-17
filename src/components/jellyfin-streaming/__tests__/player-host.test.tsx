// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const playback = vi.hoisted(() => ({ item: null as null | { Id: string } }));
vi.mock('../playback-provider', () => ({
  useJellyfinPlaybackState: () => ({ item: playback.item }),
  useJellyfinMediaMount: () => () => {},
}));
// Both chrome pieces load through next/dynamic; stand them in with markers.
vi.mock('next/dynamic', () => ({ default: () => function Chrome() { return <div data-testid="chrome" />; } }));

import { PlayerHost } from '../player-host';

describe('PlayerHost', () => {
  it('mounts the player chrome on first playback and keeps it after the item clears', () => {
    const { queryAllByTestId, rerender } = render(<PlayerHost />);
    expect(queryAllByTestId('chrome')).toHaveLength(0);

    playback.item = { Id: 'movie-1' };
    act(() => rerender(<PlayerHost />));
    expect(queryAllByTestId('chrome')).toHaveLength(2);

    playback.item = null;
    act(() => rerender(<PlayerHost />));
    expect(queryAllByTestId('chrome')).toHaveLength(2);
  });
});
