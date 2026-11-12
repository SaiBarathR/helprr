// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ResponsiveMenu,
  ResponsiveMenuActionItem,
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuLabel,
  ResponsiveMenuSortDirection,
} from './responsive-menu';

// One query object per width is cached by useIsMobile, so read the width live.
const viewport = vi.hoisted(() => ({ phone: false }));

// jsdom has no pointer capture, which the drawer asks for on a press inside it.
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === '(max-width: 767px)' && viewport.phone; },
    addEventListener() {},
    removeEventListener() {},
  }));
});

function SortMenu() {
  const [sort, setSort] = useState('title');
  return (
    <ResponsiveMenu title="Sort By" titleInDropdown trigger={<button type="button">Sort</button>}>
      <ResponsiveMenuLabel>Order</ResponsiveMenuLabel>
      {['title', 'year'].map((value) => (
        <ResponsiveMenuCheckboxItem key={value} checked={sort === value} onCheckedChange={() => setSort(value)}>
          {value}
        </ResponsiveMenuCheckboxItem>
      ))}
    </ResponsiveMenu>
  );
}

describe('ResponsiveMenu', () => {
  it('hands focus back to its trigger after keyboard use only', async () => {
    viewport.phone = false;
    // A modal dropdown sets pointer-events: none on the page; the click outside is still delivered.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<SortMenu />);
    const trigger = screen.getByRole('button', { name: 'Sort' });

    await user.click(trigger);
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'year' }));
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    // Refocusing it by script would leave a :focus-visible ring after a mouse pick.
    expect(document.activeElement).not.toBe(trigger);

    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
  });

  it('is a titled bottom sheet below md, staying open while a choice is picked', async () => {
    viewport.phone = true;
    render(<SortMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Sort' }));
    const sheet = await screen.findByRole('dialog', { name: 'Sort By' });
    expect(sheet.getAttribute('data-vaul-drawer-direction')).toBe('bottom');
    expect(screen.queryByRole('menu')).toBeNull();

    const year = within(sheet).getByRole('button', { name: 'year' });
    expect(year.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(year);
    expect(within(sheet).getByRole('button', { name: 'year' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(sheet).getByRole('button', { name: 'title' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('dialog', { name: 'Sort By' })).toBeTruthy();
    // The heading is not repeated in the body, and Done closes the sheet.
    expect(within(sheet).getAllByText('Sort By')).toHaveLength(1);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Sort By' })).toBeNull();
  });

  it('is a dropdown from md up, staying open while a choice is picked', async () => {
    viewport.phone = false;
    render(<SortMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Sort' }));
    const menu = await screen.findByRole('menu');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(menu).getByText('Sort By')).toBeTruthy();

    await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'year' }));
    expect(within(screen.getByRole('menu')).getByRole('menuitemcheckbox', { name: 'year' }).getAttribute('aria-checked')).toBe('true');
  });

  it('as an action sheet, runs a row and closes, and ends with Cancel instead of Done', async () => {
    viewport.phone = true;
    const onSelect = vi.fn();
    render(
      <ResponsiveMenu title="More actions" actions trigger={<button type="button">More</button>}>
        <ResponsiveMenuActionItem onSelect={onSelect}>Refresh</ResponsiveMenuActionItem>
        <ResponsiveMenuActionItem destructive disabled onSelect={onSelect}>Delete</ResponsiveMenuActionItem>
      </ResponsiveMenu>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog', { name: 'More actions' });
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Done' })).toBeNull();
    const del = within(sheet).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.className).toContain('text-destructive');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Refresh' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'More actions' })).toBeNull();
  });

  function DirectionMenu({ closeOnPick }: { closeOnPick?: boolean }) {
    const [dir, setDir] = useState<'asc' | 'desc'>('asc');
    return (
      <ResponsiveMenu title="Sort by" titleInDropdown closeOnPick={closeOnPick} trigger={<button type="button">Sort {dir}</button>}>
        <ResponsiveMenuSortDirection value={dir} onChange={setDir} />
        <ResponsiveMenuCheckboxItem checked onCheckedChange={() => {}}>Title</ResponsiveMenuCheckboxItem>
      </ResponsiveMenu>
    );
  }

  it('puts the direction first in a sort sheet; a pick applies and closes a one-choice menu', async () => {
    viewport.phone = true;
    render(<DirectionMenu closeOnPick />);
    await userEvent.click(screen.getByRole('button', { name: 'Sort asc' }));
    const sheet = await screen.findByRole('dialog', { name: 'Sort by' });
    const group = within(sheet).getByRole('group', { name: 'Sort direction' });
    // The control comes before the options.
    expect(group.compareDocumentPosition(within(sheet).getByRole('button', { name: 'Title' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Ascending' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(within(group).getByRole('button', { name: 'Descending' }));
    expect(screen.getByRole('button', { name: 'Sort desc' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Sort by' })).toBeNull();
  });

  it('keeps a multi-section dropdown open on a direction pick', async () => {
    viewport.phone = false;
    render(<DirectionMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Sort asc' }));
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Descending' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Descending' }).getAttribute('aria-checked')).toBe('true');
  });
});
