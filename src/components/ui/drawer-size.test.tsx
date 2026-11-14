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
      scale: 1,
      offsetTop,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal('visualViewport', viewport);
    return {
      viewport,
      fire: () => listeners.forEach((listener) => listener()),
      listening: () => listeners.size,
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

  it('takes a pinch zoom for no keyboard', () => {
    const { viewport } = stubViewport(window.innerHeight / 2);
    viewport.scale = 2;
    const panel = open('content');
    expect(panel.style.bottom).toBe('');
  });

  // iOS briefly reports the visible height as innerHeight while the keyboard moves.
  it('places itself from the layout box, not from innerHeight', () => {
    stubViewport(500);
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const bottom = this.style.inset === '0px' ? 874 : 0;
      return { top: 0, bottom, left: 0, right: 0, width: 0, height: bottom, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    try {
      vi.stubGlobal('innerHeight', 500);
      const panel = open('content');
      expect(panel.style.bottom).toBe('374px');
    } finally {
      rect.mockRestore();
    }
  });

  it('in a Safari tab, keeps clear of the address bar and scrolls as one column', () => {
    stubViewport(window.innerHeight - 300);
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)' });
    const panel = open('content');
    expect(panel.style.paddingBottom).toBe('3.75rem');
    expect(panel.hasAttribute('data-keyboard-tab')).toBe(true);
  });

  it('keeps its own body scrolling in the Home Screen app', () => {
    stubViewport(window.innerHeight - 300);
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)', standalone: true });
    const panel = open('content');
    expect(panel.style.paddingBottom).toBe('0px');
    expect(panel.hasAttribute('data-keyboard-tab')).toBe(false);
  });

  // vaul composes refs without passing a ref's cleanup on: the content must stop on its ref(null).
  it('takes its keyboard listeners and measuring box away when it unmounts', () => {
    const { listening } = stubViewport(window.innerHeight - 300);
    const boxes = () => [...document.body.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')]
      .filter((box) => box.style.position === 'fixed' && box.style.visibility === 'hidden').length;
    const view = render(
      <Drawer open>
        <DrawerContent size="content">
          <DrawerTitle>Short form</DrawerTitle>
        </DrawerContent>
      </Drawer>,
    );
    expect(boxes()).toBe(1);
    expect(listening()).toBeGreaterThan(0);
    view.unmount();
    expect(boxes()).toBe(0);
    // Its visualViewport listeners (and vaul's own) are all gone.
    expect(listening()).toBe(0);
  });

  it('leaves a drawer alone while no keyboard is open', () => {
    stubViewport(window.innerHeight);
    const panel = open('content');
    expect(panel.style.bottom).toBe('');
    expect(panel.style.maxHeight).toBe('');
  });
});

describe('DrawerContent on iOS', () => {
  const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)';

  function openForm() {
    render(
      <Drawer open>
        <DrawerContent size="content">
          <DrawerTitle>Form</DrawerTitle>
          <input aria-label="Name" />
        </DrawerContent>
      </Drawer>,
    );
    return screen.getByRole('textbox', { name: 'Name' });
  }

  function touch(target: Element, type: 'touchstart' | 'touchend', x = 10, y = 10) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'changedTouches', { value: [{ clientX: x, clientY: y }] });
    target.dispatchEvent(event);
    return event;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('focuses a tapped field itself, hidden for a frame, so Safari does not scroll the page to it', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: iPhone });
    const field = openForm();
    touch(field, 'touchstart');
    const end = touch(field, 'touchend');
    expect(end.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(field.style.transform).toBe('translateY(-2000px)');
    await waitFor(() => expect(field.style.transform).toBe(''));
  });

  it('scrolls a field focused with the keyboard up into view itself, as Safari no longer does', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: iPhone });
    render(
      <Drawer open>
        <DrawerContent size="content">
          <DrawerTitle>Form</DrawerTitle>
          <div data-testid="body" style={{ overflowY: 'auto' }}>
            <input aria-label="Password" />
            <input aria-label="Code" />
          </div>
        </DrawerContent>
      </Drawer>,
    );
    const body = screen.getByTestId('body');
    Object.defineProperty(body, 'scrollHeight', { value: 600, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });
    const code = screen.getByRole('textbox', { name: 'Code' });
    vi.spyOn(code, 'getBoundingClientRect').mockReturnValue({ top: 500, bottom: 536 } as DOMRect);
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 300 } as DOMRect);
    code.focus();
    await waitFor(() => expect(body.scrollTop).toBe(360));
  });

  it('leaves a scroll that ends on a field alone', () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: iPhone });
    const field = openForm();
    touch(field, 'touchstart', 10, 10);
    expect(touch(field, 'touchend', 10, 80).defaultPrevented).toBe(false);
  });

  it('while a field in it has focus, puts the page back where it was if iOS scrolls it', () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: iPhone });
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    Object.defineProperty(window, 'scrollY', { value: 400, configurable: true });
    try {
      const field = openForm();
      touch(field, 'touchstart');
      touch(field, 'touchend');
      Object.defineProperty(window, 'scrollY', { value: 520, configurable: true });
      window.dispatchEvent(new Event('scroll'));
      expect(scrollTo).toHaveBeenCalledWith(0, 400);
    } finally {
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    }
  });

  // Opening and closing a drawer scrolls the page too, and the user may scroll it after.
  it('leaves page scrolls alone while no field in it has focus', () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: iPhone });
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    try {
      const field = openForm();
      field.focus();
      field.blur();
      Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });
      window.dispatchEvent(new Event('scroll'));
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    }
  });

  it('in a Safari tab, keeps the sheet\'s content above Safari\'s floating address bar', () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: iPhone });
    vi.stubGlobal('visualViewport', { height: window.innerHeight - 300, scale: 1, offsetTop: 0, addEventListener() {}, removeEventListener() {} });
    openForm();
    expect(screen.getByRole('dialog', { name: 'Form' }).style.paddingBottom).toBe('3.75rem');
  });

  it('in the Home Screen app, needs no room for an address bar', () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: iPhone, standalone: true });
    vi.stubGlobal('visualViewport', { height: window.innerHeight - 300, scale: 1, offsetTop: 0, addEventListener() {}, removeEventListener() {} });
    openForm();
    expect(screen.getByRole('dialog', { name: 'Form' }).style.paddingBottom).toBe('0px');
  });

  it('does nothing outside iOS', () => {
    const field = openForm();
    touch(field, 'touchstart');
    expect(touch(field, 'touchend').defaultPrevented).toBe(false);
  });
});
