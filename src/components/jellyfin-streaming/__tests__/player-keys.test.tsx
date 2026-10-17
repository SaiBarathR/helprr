// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { keyBelongsElsewhere } from '@/components/jellyfin-streaming/video-stage';

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
});
