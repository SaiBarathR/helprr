// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProwlarrIndexerSummary } from '@/lib/prowlarr-client';
import { HISTORY_FILTERS, HistoryFilterBar, historyActiveFilters } from './history-filters';

// The menu as plain buttons: the trigger, then the items.
vi.mock('@/components/ui/responsive-menu', () => ({
  ResponsiveMenu: ({ trigger, title, children }: { trigger: ReactNode; title: string; children: ReactNode }) => (
    <div>{trigger}<div role="menu" aria-label={title}>{children}</div></div>
  ),
  ResponsiveMenuCheckboxItem: ({ children, checked, onCheckedChange }: { children: ReactNode; checked: boolean; onCheckedChange: () => void }) => (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} onClick={onCheckedChange}>{children}</button>
  ),
  ResponsiveMenuLabel: ({ children }: { children: ReactNode }) => <div role="presentation">{children}</div>,
  ResponsiveMenuSeparator: () => <hr />,
}));

const indexer = (id: number, name: string) => ({ id, name }) as ProwlarrIndexerSummary;

function renderBar(props: Partial<Parameters<typeof HistoryFilterBar>[0]> = {}) {
  const handlers = { onFilterChange: vi.fn(), onIndexerChange: vi.fn(), onSortChange: vi.fn() };
  render(
    <HistoryFilterBar
      activeFilter=""
      indexerId={null}
      indexerOptions={[indexer(3, 'EZTV')]}
      sort="newest"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const menu = () => within(screen.getByRole('menu', { name: 'Filter' }));

describe('Prowlarr history filters', () => {
  it('filters by Prowlarr’s auth and info events, named as the rows name them', () => {
    expect(HISTORY_FILTERS.map((f) => [f.label, f.eventType ?? null])).toEqual([
      ['All', null], ['Grab', '1'], ['Search', '2'], ['RSS', '3'], ['Auth', '4'], ['Info', '5'], ['Failed', null],
    ]);
  });

  it('picks an event and an indexer from the one filter menu', async () => {
    const { onFilterChange, onIndexerChange } = renderBar();
    await userEvent.click(menu().getByRole('menuitemcheckbox', { name: 'Auth' }));
    expect(onFilterChange).toHaveBeenCalledWith('4');
    await userEvent.click(menu().getByRole('menuitemcheckbox', { name: 'EZTV' }));
    expect(onIndexerChange).toHaveBeenCalledWith(3);
  });

  it('marks the filter button while an event or an indexer is picked', () => {
    renderBar({ activeFilter: '5' });
    expect(screen.getByRole('button', { name: 'Filter (filters active)' })).toBeTruthy();
    expect(menu().getByRole('menuitemcheckbox', { name: 'Info' }).getAttribute('aria-checked')).toBe('true');
  });

  it('names the event and the indexer as chips that clear themselves', () => {
    const onFilterChange = vi.fn();
    const onIndexerChange = vi.fn();
    const chips = historyActiveFilters({ activeFilter: 'failed', onFilterChange, indexerId: 3, indexerLabel: 'EZTV', onIndexerChange });
    expect(chips.map((chip) => chip.label)).toEqual(['Failed', 'EZTV']);
    chips[0].onRemove();
    chips[1].onRemove();
    expect(onFilterChange).toHaveBeenCalledWith('');
    expect(onIndexerChange).toHaveBeenCalledWith(null);
    expect(historyActiveFilters({ activeFilter: '', onFilterChange, indexerId: null, indexerLabel: 'All indexers', onIndexerChange })).toEqual([]);
  });

  it('flips the order and says which one is showing', async () => {
    const { onSortChange } = renderBar({ sort: 'oldest' });
    await userEvent.click(screen.getByRole('button', { name: 'Oldest first. Show newest first' }));
    expect(onSortChange).toHaveBeenCalledWith('newest');
  });
});
