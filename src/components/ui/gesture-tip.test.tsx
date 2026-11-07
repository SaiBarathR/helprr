// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GestureTip } from '@/components/ui/gesture-tip';
import { useUIStore } from '@/lib/store';
import { UI_PREFS_STORAGE_KEY } from '@/lib/dashboard-theme';

function setPointer(coarse: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('GestureTip', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({ ...useUIStore.getInitialState(), hasHydrated: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows once on a touch device and stays dismissed', async () => {
    setPointer(true);
    const user = userEvent.setup();
    const { unmount } = render(<GestureTip id="long-press" />);

    expect(screen.getByRole('note').textContent).toBe('Tip: Press and hold a title for quick actions.');
    await user.click(screen.getByRole('button', { name: 'Dismiss tip' }));
    expect(screen.queryByRole('note')).toBeNull();

    unmount();
    render(<GestureTip id="long-press" />);
    expect(screen.queryByRole('note')).toBeNull();
    // Persisted with the other UI prefs, so it survives a reload.
    expect(JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) ?? '{}').state.dismissedTips).toEqual(['long-press']);
  });

  it('keeps each tip separate', async () => {
    setPointer(true);
    useUIStore.getState().dismissTip('long-press');
    render(<GestureTip id="notification-swipe" />);

    expect(screen.getByRole('note').textContent).toContain('Swipe a notification');
  });

  it('never shows touch gestures on a mouse-only device', () => {
    setPointer(false);
    render(<GestureTip id="long-press" />);

    expect(screen.queryByRole('note')).toBeNull();
  });

  it('waits for saved prefs to load before showing', () => {
    setPointer(true);
    useUIStore.setState({ hasHydrated: false });
    render(<GestureTip id="long-press" />);

    expect(screen.queryByRole('note')).toBeNull();
  });
});
