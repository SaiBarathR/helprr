// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProwlarrAppProfile, ProwlarrIndexerSummary } from '@/lib/prowlarr-client';
import { IndexerBulkBar } from './indexer-bulk-bar';
import type { IndexerActions } from './use-indexer-actions';

const mocks = vi.hoisted(() => ({ isMobile: false }));
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => mocks.isMobile }));
// In place, not portalled: the test reads the bar as one tree.
vi.mock('@/components/ui/floating-action-bar', () => ({
  FloatingActionBar: ({ children }: { children: ReactNode }) => <div role="toolbar" aria-label="Bulk actions">{children}</div>,
}));

const indexers = [
  { id: 1, name: 'EZTV', priority: 25, appProfileId: 1, tags: [] },
  { id: 2, name: 'Nyaa', priority: 25, appProfileId: 1, tags: [] },
] as unknown as ProwlarrIndexerSummary[];
const profiles = [{ id: 1, name: 'Standard' }, { id: 2, name: 'Interactive' }] as ProwlarrAppProfile[];

function renderBar() {
  const handleBulkEdit = vi.fn(async () => true);
  render(
    <IndexerBulkBar
      selected={indexers}
      allSelected={false}
      onToggleAll={vi.fn()}
      onCancel={vi.fn()}
      onDeleted={vi.fn()}
      tags={[{ id: 1, label: 'flaresolverr' }]}
      profiles={profiles}
      actions={{ handleBulkEdit, handleBulkDelete: vi.fn(), bulkDeleting: false } as unknown as IndexerActions}
    />,
  );
  return { handleBulkEdit, bar: within(screen.getByRole('toolbar', { name: 'Bulk actions' })) };
}

describe('IndexerBulkBar', () => {
  beforeEach(() => { mocks.isMobile = false; });

  it('shows every action on the bar from sm up', () => {
    const { bar } = renderBar();
    for (const name of ['Enable', 'Disable', 'Priority', 'App profile', 'Tags', 'Delete']) {
      expect(bar.getByRole('button', { name })).toBeTruthy();
    }
    expect(bar.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('on a phone, keeps Delete on the bar and moves the pickers into More actions', async () => {
    mocks.isMobile = true;
    const user = userEvent.setup();
    const { bar, handleBulkEdit } = renderBar();
    for (const name of ['Enable', 'Disable', 'Delete', 'More actions']) {
      expect(bar.getByRole('button', { name })).toBeTruthy();
    }
    for (const name of ['Priority', 'App profile', 'Tags']) {
      expect(bar.queryByRole('button', { name })).toBeNull();
    }

    await user.click(bar.getByRole('button', { name: 'More actions' }));
    const menu = within(await screen.findByRole('menu', { name: 'More actions' }));
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Priority', 'App profile', 'Tags']);

    // The pick shows its picker in the same popover, which applies as on the bar.
    await user.click(menu.getByRole('menuitem', { name: 'Priority' }));
    await user.click(screen.getByRole('button', { name: 'Raise the priority number' }));
    await user.click(screen.getByRole('button', { name: 'Set priority' }));
    expect(handleBulkEdit).toHaveBeenCalledWith(indexers, expect.any(Function), { priority: 26 }, expect.anything());
    expect(screen.queryByRole('button', { name: 'Set priority' })).toBeNull();
  });
});
