// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ResponsiveMenu,
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuLabel,
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
});
