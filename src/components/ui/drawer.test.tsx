// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from './drawer';

// jsdom has no pointer capture, which the drawer asks for on a press inside it.
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

describe('Drawer on an iPhone', () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // vaul takes its iOS paths from navigator.platform.
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('iPhone');
    scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 3000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // iOS drops a tap whose page scrolls under the finger, so a page that jumped
  // on open and on every press left the More sheet's links dead after a scroll.
  it('leaves a scrolled page where it is when it opens and while it is pressed', () => {
    render(
      <Drawer>
        <DrawerTrigger>More</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>More</DrawerTitle>
          <a href="/calendar">Calendar</a>
        </DrawerContent>
      </Drawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const link = screen.getByRole('link', { name: 'Calendar' });
    fireEvent.pointerDown(link, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(link, { pointerId: 1, button: 0 });
    expect(scrollTo).not.toHaveBeenCalled();
    // The page stays locked by the dialog's overlay instead.
    expect(document.querySelector('[data-slot="drawer-overlay"]')).not.toBeNull();
  });
});
