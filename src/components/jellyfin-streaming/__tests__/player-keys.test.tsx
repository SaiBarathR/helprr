// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { keyBelongsElsewhere } from '@/components/jellyfin-streaming/video-stage';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.getElementById('target')!;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('player keyboard shortcuts', () => {
  it.each([
    ['a text field', '<input id="target">'],
    ['a text area', '<textarea id="target"></textarea>'],
    ['a select', '<select id="target"></select>'],
    ['editable content', '<div contenteditable="true"><span id="target">x</span></div>'],
    ['a dialog', '<div role="dialog"><button id="target">OK</button></div>'],
    ['an alert dialog', '<div role="alertdialog"><button id="target">Delete</button></div>'],
    ['a menu', '<div role="menu"><div role="menuitem" id="target">Rename</div></div>'],
    ['a list popup', '<div role="listbox"><div role="option" id="target">English</div></div>'],
  ])('leave keys pressed in %s to it', (_name, html) => {
    expect(keyBelongsElsewhere(mount(html))).toBe(true);
  });

  it('keep working in the player and in its own queue panel', () => {
    expect(keyBelongsElsewhere(mount('<div><button id="target">Pause</button></div>'))).toBe(false);
    expect(keyBelongsElsewhere(mount('<div role="dialog" data-player-queue=""><button id="target">Episode 2</button></div>'))).toBe(false);
    expect(keyBelongsElsewhere(window)).toBe(false);
  });

  it('still leave a text field inside the queue panel alone', () => {
    expect(keyBelongsElsewhere(mount('<div role="dialog" data-player-queue=""><input id="target"></div>'))).toBe(true);
  });

  it('leave keys to a dialog\'s dropdown, which renders outside the dialog', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <DropdownMenu open>
            <DropdownMenuTrigger>Options</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Rename</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </DialogContent>
      </Dialog>,
    ));

    const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent === 'Rename') as HTMLElement;
    expect(item.closest('[role="dialog"]')).toBeNull(); // portaled out of the dialog
    expect(keyBelongsElsewhere(item)).toBe(true);
    await act(async () => root.unmount());
  });
});
