// @vitest-environment jsdom

import type { ReactElement, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

import { showUnfollowNotice } from './unfollow-notice';

describe('playlist unfollow notice', () => {
  beforeEach(() => mocks.toast.mockReset());

  it('links a manager to the rules of the channels that still download', () => {
    showUnfollowNotice({
      done: 'Unfollowed',
      name: 'Mix',
      result: {
        othersFollow: true,
        othersFollowing: 2,
        autoDownload: true,
        channels: [{ id: 'c1', name: 'Trash Taste' }, { id: 'c2', name: 'Gaming' }],
        moreChannels: 3,
      },
    });
    const [message, options] = mocks.toast.mock.calls[0] as [string, { description: ReactElement; action?: unknown }];
    expect(message).toBe('Unfollowed. 2 other people still follow Mix, so new videos can still download.');
    expect(options.action).toBeUndefined();
    render(options.description);
    expect(screen.getByRole('link', { name: 'Trash Taste' }).getAttribute('href')).toBe('/youtube/channels/c1/rules');
    expect(screen.getByRole('link', { name: 'Gaming' }).getAttribute('href')).toBe('/youtube/channels/c2/rules');
    expect(screen.getByText(/and 3 more/)).toBeTruthy();
  });

  it('only warns when no channel can be linked, and tells a member just that someone else follows', () => {
    showUnfollowNotice({ done: 'Unfollowed', name: 'Mix', result: { othersFollow: true, othersFollowing: 1, autoDownload: true, channels: [] } });
    expect(mocks.toast).toHaveBeenLastCalledWith('Unfollowed. 1 other person still follows Mix, so new videos can still download.');

    showUnfollowNotice({ done: 'Unfollowed', name: 'Mix', result: { othersFollow: true } });
    expect(mocks.toast).toHaveBeenLastCalledWith('Unfollowed. Someone else still follows Mix.');

    mocks.toast.mockReset();
    showUnfollowNotice({ done: 'Unfollowed', name: 'Mix', result: { othersFollow: false } });
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
