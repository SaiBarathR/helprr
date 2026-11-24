// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HISTORY_FILTERS, HistoryFilterBar } from './history-filters';

function renderBar(props: Partial<Parameters<typeof HistoryFilterBar>[0]> = {}) {
  const handlers = { onFilterChange: vi.fn(), onIndexerChange: vi.fn(), onSortChange: vi.fn() };
  render(
    <HistoryFilterBar
      activeFilter=""
      indexerId={null}
      indexerLabel="All indexers"
      indexerOptions={[]}
      sort="newest"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('Prowlarr history filters', () => {
  it('filters by Prowlarr’s auth and info events, named as the rows name them', () => {
    expect(HISTORY_FILTERS.map((f) => [f.label, f.eventType ?? null])).toEqual([
      ['All', null], ['Grab', '1'], ['Search', '2'], ['RSS', '3'], ['Auth', '4'], ['Info', '5'], ['Failed', null],
    ]);
  });

  it('picks an event from its pill', async () => {
    const { onFilterChange } = renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Auth' }));
    expect(onFilterChange).toHaveBeenCalledWith('4');
  });

  it('names the picked event on the phone menu', () => {
    renderBar({ activeFilter: '5' });
    expect(screen.getByRole('button', { name: 'Event: Info' })).toBeTruthy();
  });

  it('flips the order and says which one is showing', async () => {
    const { onSortChange } = renderBar({ sort: 'oldest' });
    await userEvent.click(screen.getByRole('button', { name: 'Oldest first. Show newest first' }));
    expect(onSortChange).toHaveBeenCalledWith('newest');
  });
});
