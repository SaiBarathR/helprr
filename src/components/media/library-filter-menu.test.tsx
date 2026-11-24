// @vitest-environment jsdom

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponsiveMenu } from '@/components/ui/responsive-menu';
import { useLibraryFilterMenu } from './library-filter-menu';
import { EMPTY_LIBRARY_FACETS, type LibraryFacetFilters } from '@/lib/library-filtering';
import type { SavedLibraryFilter } from '@/lib/library-saved-filters';
import type { RadarrMovieListItem } from '@/types';

const viewport = vi.hoisted(() => ({ phone: false }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === '(max-width: 767px)' && viewport.phone; },
    addEventListener() {},
    removeEventListener() {},
  }));
});

const MOVIES = [
  { id: 1, title: 'A', instanceId: 'a', instanceLabel: 'Radarr A', tags: [3], tagLabels: ['4k'], genres: ['Drama'] },
  { id: 1, title: 'B', instanceId: 'b', instanceLabel: 'Radarr B', tags: [3], tagLabels: ['anime'], genres: [] },
] as unknown as RadarrMovieListItem[];

// The parts of a library page the filter menu drives, with the page's state kept here.
function Page({ onSaved }: { onSaved: (list: SavedLibraryFilter[]) => void }) {
  const [status, setStatus] = useState<string[]>([]);
  const [facets, setFacets] = useState<LibraryFacetFilters>(EMPTY_LIBRARY_FACETS);
  const [instance, setInstance] = useState('all');
  const [saved, setSaved] = useState<SavedLibraryFilter[]>([]);
  const menu = useLibraryFilterMenu({
    items: MOVIES, status, setStatus, facets, setFacets, instance, setInstance, watch: 'all', saved,
    updateSaved: (update) => setSaved((list) => {
      const next = update(list);
      onSaved(next);
      return next;
    }),
  });
  return (
    <>
      <ResponsiveMenu title="Filter" titleInDropdown open={menu.menuOpen} onOpenChange={menu.setMenuOpen} trigger={<button type="button">Filter</button>}>
        {menu.savedSection}
        {menu.facetGroups}
      </ResponsiveMenu>
      <p data-testid="chips">{menu.facetChips.map((chip) => chip.label).join(' | ')}</p>
      <button type="button" onClick={menu.clearMenuFilters}>Clear all</button>
      {menu.dialogs}
    </>
  );
}

describe('library filter menu', () => {
  it.each([false, true])('saves the picked filters under a name and applies them again (phone: %s)', async (phone) => {
    viewport.phone = phone;
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSaved = vi.fn();
    render(<Page onSaved={onSaved} />);
    const item = (name: string) => (phone ? screen.findByRole('button', { name }) : screen.findByRole('menuitemcheckbox', { name }));
    const action = (name: string) => (phone ? screen.findByRole('button', { name }) : screen.findByRole('menuitem', { name }));

    // The same tag id on two instances is two choices, named with their instance.
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    expect(await item('anime (Radarr B)')).toBeTruthy();
    await user.click(await item('4k (Radarr A)'));
    expect(screen.getByTestId('chips').textContent).toBe('Tag: 4k (Radarr A)');

    await user.click(await action('Save current filters…'));
    const dialog = await screen.findByRole('dialog', { name: 'Save current filters' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Filter name' }), '4K on A{Enter}');
    expect(onSaved).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: '4K on A', status: [], instance: 'all', facets: { ...EMPTY_LIBRARY_FACETS, tags: ['a:3'] } }),
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByTestId('chips').textContent).toBe('');

    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(await item('4K on A'));
    expect(screen.getByTestId('chips').textContent).toBe('Tag: 4k (Radarr A)');
    if (phone) {
      expect((await item('4K on A')).getAttribute('aria-pressed')).toBe('true');
    } else {
      expect((await item('4K on A')).getAttribute('aria-checked')).toBe('true');
    }
  });

  it('renames and deletes a saved filter', async () => {
    viewport.phone = false;
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSaved = vi.fn();
    render(<Page onSaved={onSaved} />);
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Drama' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Save current filters…' }));
    await user.type(await screen.findByRole('textbox', { name: 'Filter name' }), 'Dramas');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rename or delete…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Saved filters' });
    await user.click(within(dialog).getByRole('button', { name: 'Rename Dramas' }));
    const field = within(dialog).getByRole('textbox', { name: 'New name for Dramas' });
    await user.clear(field);
    await user.type(field, 'Drama only{Enter}');
    expect(onSaved).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'Drama only' })]);

    await user.click(within(dialog).getByRole('button', { name: 'Delete Drama only' }));
    expect(onSaved).toHaveBeenLastCalledWith([]);
    expect(within(dialog).getByText('No saved filters.')).toBeTruthy();

    // Undo from the toast puts it back.
    const [, options] = toast.mock.calls.at(-1) as [string, { action: { onClick: () => void } }];
    act(() => options.action.onClick());
    expect(onSaved).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'Drama only' })]);

    // Escape mid-rename cancels the rename and keeps the dialog open.
    await user.click(within(dialog).getByRole('button', { name: 'Rename Drama only' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Saved filters' })).toBeTruthy();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
  });
});
