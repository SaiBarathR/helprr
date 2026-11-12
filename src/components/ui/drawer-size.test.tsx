// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});

describe('DrawerContent above the keyboard', () => {
  function stubViewport(height: number, offsetTop = 0) {
    const listeners = new Set<() => void>();
    const viewport = {
      height,
      offsetTop,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal('visualViewport', viewport);
    return {
      viewport,
      fire: () => listeners.forEach((listener) => listener()),
    };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('sits on top of the keyboard and keeps its top on screen', () => {
    stubViewport(window.innerHeight - 300);
    const panel = open('content');
    expect(panel.style.bottom).toBe('300px');
    expect(panel.style.maxHeight).toContain(`${window.innerHeight - 300}px`);
    expect(panel.style.paddingBottom).toBe('0px');
  });

  it('allows for iOS scrolling the visible part up to a field', () => {
    stubViewport(window.innerHeight - 400, 100);
    const panel = open();
    expect(panel.style.bottom).toBe('300px');
  });

  it('goes back to its own classes once the keyboard closes, whatever happened while it was open', async () => {
    const { viewport, fire } = stubViewport(window.innerHeight - 300);
    const panel = open('content');
    expect(panel.style.bottom).toBe('300px');
    viewport.height = window.innerHeight;
    fire();
    await waitFor(() => expect(panel.style.bottom).toBe(''));
    expect(panel.style.maxHeight).toBe('');
    expect(panel.style.paddingBottom).toBe('');
  });

  it('leaves a drawer alone while no keyboard is open', () => {
    stubViewport(window.innerHeight);
    const panel = open('content');
    expect(panel.style.bottom).toBe('');
    expect(panel.style.maxHeight).toBe('');
  });
});
