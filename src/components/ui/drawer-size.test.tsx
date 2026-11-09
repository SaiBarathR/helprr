// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Drawer, DrawerContent, DrawerTitle } from './drawer';

function open(size?: 'full' | 'content') {
  render(
    <Drawer open>
      <DrawerContent size={size}>
        <DrawerTitle>Short form</DrawerTitle>
      </DrawerContent>
    </Drawer>,
  );
  return screen.getByRole('dialog', { name: 'Short form' });
}

describe('DrawerContent size', () => {
  it('is a fixed 90dvh bottom panel by default', () => {
    const panel = open();
    expect(panel.className).toContain('data-[vaul-drawer-direction=bottom]:h-[90dvh]');
    expect(panel.className).not.toContain('data-[vaul-drawer-direction=bottom]:h-auto');
  });

  it('sizes a short form to its content, still capped at 90dvh', () => {
    const panel = open('content');
    expect(panel.className).toContain('data-[vaul-drawer-direction=bottom]:h-auto');
    expect(panel.className).not.toContain('data-[vaul-drawer-direction=bottom]:h-[90dvh]');
    expect(panel.className).toContain('data-[vaul-drawer-direction=bottom]:max-h-[90dvh]');
    expect(panel.hasAttribute('size')).toBe(false);
  });

  // vaul writes back, on every keyboard close, the height the drawer had when a
  // keyboard first opened in it: a later, taller step would be cut to that.
  it('drops the inline height vaul restores once the keyboard is closed, only for a content drawer', async () => {
    const panel = open('content');
    panel.style.height = '330px';
    await waitFor(() => expect(panel.style.height).toBe(''));
  });

  it('keeps vaul\'s height while the keyboard is open', async () => {
    vi.stubGlobal('visualViewport', { height: window.innerHeight - 300, addEventListener: () => {}, removeEventListener: () => {} });
    try {
      const panel = open('content');
      panel.style.height = '330px';
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(panel.style.height).toBe('330px');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves a full drawer\'s inline height to vaul', async () => {
    const panel = open();
    panel.style.height = '330px';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.style.height).toBe('330px');
  });
});
