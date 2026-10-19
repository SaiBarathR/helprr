// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomHistoryItem } from '@/types/jellyfin';
import { Carousel, CustomHistoryRow, ServerErrorState, toDateStr, todayStr } from '../shared';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const historyItem = (extra: Partial<CustomHistoryItem> = {}): CustomHistoryItem => ({
  RowId: 1, DateCreated: '2026-02-20 19:11:07.0338097', UserId: 'u1', ItemId: 'i1', ItemType: 'Movie',
  ItemName: 'Film A', PlaybackMethod: 'DirectPlay', ClientName: 'Infuse', DeviceName: 'iPhone', PlayDuration: 3720,
  ...extra,
});

describe('Jellyfin page helpers', () => {
  it('formats a local date as YYYY-MM-DD, as the Playback Reporting plugin expects', () => {
    expect(toDateStr(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    vi.useFakeTimers({ now: new Date(2026, 9, 19, 0, 30) });
    expect(todayStr()).toBe('2026-10-19');
  });

  it('shows a history row: name, client, device, play time, method and date', () => {
    render(<CustomHistoryRow item={historyItem()} />);
    expect(screen.getByText('Film A')).toBeTruthy();
    expect(screen.getByText('Infuse')).toBeTruthy();
    expect(screen.getByText('iPhone')).toBeTruthy();
    expect(screen.getByText('1h 2m')).toBeTruthy();
    expect(screen.getByTitle('DirectPlay').className).toContain('text-green-500');
    expect(screen.getByText(/Feb 20, 2026/)).toBeTruthy();
  });

  it('colours each playback method, and leaves an unknown one plain', () => {
    const { rerender } = render(<CustomHistoryRow item={historyItem({ PlaybackMethod: 'DirectStream' })} />);
    expect(screen.getByTitle('DirectStream').className).toContain('text-blue-500');
    rerender(<CustomHistoryRow item={historyItem({ PlaybackMethod: 'Transcode (v:h264 a:direct)' })} />);
    expect(screen.getByTitle('Transcode (v:h264 a:direct)').className).toContain('text-orange-500');
    rerender(<CustomHistoryRow item={historyItem({ PlaybackMethod: 'Unknown' })} />);
    expect(screen.getByTitle('Unknown').className).not.toMatch(/text-(green|blue|orange)-500/);
  });

  it('shows a date it cannot read as it came', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<CustomHistoryRow item={historyItem({ DateCreated: 'not a date' })} />);
    expect(screen.getByText('not a date')).toBeTruthy();
  });

  it('offers a retry when the server cannot be reached', async () => {
    const onRetry = vi.fn();
    render(<ServerErrorState onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't reach the Jellyfin server");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keys a carousel\'s scroll position under the Jellyfin page', () => {
    const { container } = render(<Carousel restorationKey="resume"><span>card</span></Carousel>);
    expect(container.querySelector('[data-scroll-restoration-key="jellyfin:resume"]')?.textContent).toBe('card');
  });
});
