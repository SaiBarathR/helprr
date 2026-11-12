// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandEmpty, CommandGroup, CommandItem } from './command';
import { ResponsiveCombobox } from './responsive-combobox';

// One query object per width is cached by useIsMobile, so read the width live.
const viewport = vi.hoisted(() => ({ phone: false }));

// jsdom has no pointer capture, which the drawer asks for on a press inside it.
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === '(max-width: 767px)' && viewport.phone; },
    addEventListener() {},
    removeEventListener() {},
  }));
});

function ZonePicker({ initial = 'UTC' }: { initial?: string }) {
  const [open, setOpen] = useState(false);
  const [zone, setZone] = useState(initial);
  return (
    <ResponsiveCombobox
      open={open}
      onOpenChange={setOpen}
      title="Your time zone"
      searchPlaceholder="Search time zones"
      selectedValue={zone}
      trigger={<button type="button">{zone}</button>}
    >
      <CommandEmpty>No matches.</CommandEmpty>
      <CommandGroup>
        {['Europe/London', 'America/New_York'].map((value) => (
          <CommandItem key={value} value={value} onSelect={() => { setZone(value); setOpen(false); }}>
            {value}
          </CommandItem>
        ))}
      </CommandGroup>
    </ResponsiveCombobox>
  );
}

describe('ResponsiveCombobox', () => {
  it('is a titled bottom sheet below md, with the search field not focused', async () => {
    viewport.phone = true;
    render(<ZonePicker />);
    await userEvent.click(screen.getByRole('button', { name: 'UTC' }));
    const sheet = await screen.findByRole('dialog', { name: 'Your time zone' });
    expect(sheet.getAttribute('data-vaul-drawer-direction')).toBe('bottom');
    // A focused field would open the phone keyboard as the sheet opens.
    const search = within(sheet).getByPlaceholderText('Search time zones');
    expect(document.activeElement).not.toBe(search);

    await userEvent.type(search, 'york');
    expect(within(sheet).queryByText('Europe/London')).toBeNull();
    await userEvent.click(within(sheet).getByText('America/New_York'));
    expect(screen.queryByRole('dialog', { name: 'Your time zone' })).toBeNull();
    expect(screen.getByRole('button', { name: 'America/New_York' })).toBeTruthy();
  });

  it('starts with the current pick highlighted, where its tick is', async () => {
    viewport.phone = true;
    render(<ZonePicker initial="America/New_York" />);
    await userEvent.click(screen.getByRole('button', { name: 'America/New_York' }));
    const sheet = await screen.findByRole('dialog', { name: 'Your time zone' });
    const selected = within(sheet).getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected.map((o) => o.textContent)).toEqual(['America/New_York']);
  });

  it('is a popover from md up', async () => {
    viewport.phone = false;
    render(<ZonePicker />);
    await userEvent.click(screen.getByRole('button', { name: 'UTC' }));
    expect(screen.queryByRole('dialog', { name: 'Your time zone' })).toBeNull();
    expect(await screen.findByPlaceholderText('Search time zones')).toBeTruthy();
  });
});
